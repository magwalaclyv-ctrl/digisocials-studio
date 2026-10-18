import json
from unittest.mock import Mock, patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from apps.accounts.models import User
from apps.composer.models import PostTemplate
from apps.media_library.models import MediaAsset
from apps.media_library.quotas import StorageQuotaExceededError
from apps.media_library.services import create_asset
from apps.members.models import OrgMembership, WorkspaceMembership
from apps.organizations.models import Organization
from apps.workspaces.models import Workspace

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 28


class StudioFeatureTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email="studio-owner@example.com",
            password="test-password",
            tos_accepted_at=timezone.now(),
        )
        self.org = Organization.objects.create(name="Studio Org")
        self.workspace = Workspace.objects.create(organization=self.org, name="Studio Workspace")
        OrgMembership.objects.create(
            user=self.user,
            organization=self.org,
            org_role=OrgMembership.OrgRole.OWNER,
        )
        WorkspaceMembership.objects.create(
            user=self.user,
            workspace=self.workspace,
            workspace_role=WorkspaceMembership.WorkspaceRole.OWNER,
        )
        self.client.force_login(self.user)

    def test_ai_ideas_return_clearly_labelled_local_prompts_without_credentials(self):
        response = self.client.post(
            reverse("composer:idea_generate", kwargs={"workspace_id": self.workspace.id}),
            {"topic": "small business bookkeeping", "audience": "freelancers", "platform": "LinkedIn"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["source"], "starter-prompts")
        self.assertEqual(len(payload["ideas"]), 4)
        self.assertIn("small business bookkeeping", payload["ideas"][0]["title"])

    @override_settings(
        POST_IDEAS_API_KEY="test-provider-key",
        POST_IDEAS_API_URL="https://provider.test/v1/chat/completions",
        POST_IDEAS_MODEL="test-model",
    )
    @patch("apps.composer.ai_ideas.httpx.post")
    def test_ai_ideas_use_configured_provider_and_validate_its_content(self, post):
        post.return_value = Mock(
            json=lambda: {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "ideas": [
                                        {"title": "An honest checklist", "description": "Share a useful checklist."}
                                    ]
                                }
                            )
                        }
                    }
                ]
            }
        )

        response = self.client.post(
            reverse("composer:idea_generate", kwargs={"workspace_id": self.workspace.id}),
            {"topic": "checklists"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["source"], "ai")
        self.assertEqual(response.json()["ideas"][0]["title"], "An honest checklist")
        self.assertEqual(post.call_args.kwargs["headers"]["Authorization"], "Bearer test-provider-key")

    def test_studio_saves_workspace_scoped_template_with_network_dimensions(self):
        response = self.client.post(
            reverse("composer:studio_template", kwargs={"workspace_id": self.workspace.id}),
            {
                "name": "Story launch",
                "description": "An editable launch story",
                "format": "instagram-story",
                "headline": "A new chapter",
                "body": "A short message",
                "cta": "Explore",
                "background_color": "#123456",
                "text_color": "#ffffff",
            },
        )

        self.assertRedirects(
            response,
            reverse("composer:template_list", kwargs={"workspace_id": self.workspace.id}),
        )
        template = PostTemplate.objects.get(workspace=self.workspace, name="Story launch")
        self.assertEqual(template.template_data["studio"]["width"], 1080)
        self.assertEqual(template.template_data["studio"]["height"], 1920)
        self.assertEqual(template.template_data["caption"], "A short message")

    def test_studio_rejects_unknown_format_and_invalid_color(self):
        response = self.client.post(
            reverse("composer:studio_template", kwargs={"workspace_id": self.workspace.id}),
            {
                "name": "Bad layout",
                "format": "not-a-network-format",
                "headline": "Example",
                "body": "",
                "cta": "",
                "background_color": "#000000; color: red",
                "text_color": "#ffffff",
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertContains(response, 'value="Bad layout"', status_code=400)
        self.assertContains(response, 'value="Example"', status_code=400)
        self.assertFalse(PostTemplate.objects.filter(workspace=self.workspace).exists())

    def test_studio_edits_only_a_template_in_the_current_workspace(self):
        template = PostTemplate.objects.create(
            workspace=self.workspace,
            name="Existing",
            template_data={"caption": "Old", "studio": {"format": "instagram-square"}},
            created_by=self.user,
        )
        response = self.client.post(
            reverse(
                "composer:studio_template_edit",
                kwargs={"workspace_id": self.workspace.id, "template_id": template.id},
            ),
            {
                "name": "Updated",
                "format": "youtube-thumbnail",
                "headline": "Watch this",
                "body": "A new video",
                "cta": "",
                "background_color": "#111111",
                "text_color": "#ffffff",
            },
        )

        self.assertEqual(response.status_code, 302)
        template.refresh_from_db()
        self.assertEqual(template.name, "Updated")
        self.assertEqual(template.template_data["studio"]["format"], "youtube-thumbnail")
        self.assertEqual(template.template_data["studio"]["width"], 1280)
        self.assertEqual(template.template_data["studio"]["height"], 720)

    def test_studio_can_use_org_shared_images_but_rejects_other_org_images(self):
        shared_asset = create_asset(
            self.org,
            None,
            SimpleUploadedFile("shared.jpg", JPEG, content_type="image/jpeg"),
            self.user,
        )
        other_org = Organization.objects.create(name="Other Studio Org")
        other_workspace = Workspace.objects.create(organization=other_org, name="Other Workspace")
        foreign_asset = create_asset(
            other_org,
            other_workspace,
            SimpleUploadedFile("foreign.jpg", JPEG, content_type="image/jpeg"),
            self.user,
        )
        editor_url = reverse("composer:studio_template", kwargs={"workspace_id": self.workspace.id})

        response = self.client.get(editor_url)
        self.assertContains(response, "shared.jpg")
        self.assertNotContains(response, "foreign.jpg")
        picker_response = self.client.get(
            reverse("composer:media_picker", kwargs={"workspace_id": self.workspace.id})
        )
        self.assertContains(picker_response, "shared.jpg")
        self.assertNotContains(picker_response, "foreign.jpg")

        shared_response = self.client.post(
            editor_url,
            {
                "name": "Shared image layout",
                "format": "instagram-square",
                "headline": "Hello",
                "body": "",
                "cta": "",
                "background_color": "#123456",
                "text_color": "#ffffff",
                "media_asset_id": str(shared_asset.id),
            },
        )
        self.assertEqual(shared_response.status_code, 302)
        template = PostTemplate.objects.get(workspace=self.workspace, name="Shared image layout")
        self.assertEqual(template.template_data["studio"]["media_asset_id"], str(shared_asset.id))

        use_response = self.client.get(
            reverse(
                "composer:use_template",
                kwargs={"workspace_id": self.workspace.id, "template_id": template.id},
            ),
            follow=True,
        )
        self.assertEqual(use_response.status_code, 200)
        self.assertEqual(
            list(use_response.context["pending_assets"].values_list("id", flat=True)),
            [shared_asset.id],
        )

        foreign_response = self.client.post(
            editor_url,
            {
                "name": "Foreign image layout",
                "format": "instagram-square",
                "headline": "Hello",
                "body": "",
                "cta": "",
                "background_color": "#123456",
                "text_color": "#ffffff",
                "media_asset_id": str(foreign_asset.id),
            },
        )
        self.assertEqual(foreign_response.status_code, 400)
        self.assertFalse(PostTemplate.objects.filter(workspace=self.workspace, name="Foreign image layout").exists())

    def test_media_library_upload_page_includes_a_file_picker_and_csrf_token(self):
        response = self.client.get(reverse("media_library:index", kwargs={"workspace_id": self.workspace.id}))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'type="file"')
        self.assertContains(response, 'name="csrfmiddlewaretoken"')

    @patch("apps.media_library.views.create_asset")
    def test_media_library_upload_returns_a_clear_quota_error(self, create_asset_mock):
        create_asset_mock.side_effect = StorageQuotaExceededError(used=100, limit=100, attempted=1)

        response = self.client.post(
            reverse("media_library:upload", kwargs={"workspace_id": self.workspace.id}),
            {"files": SimpleUploadedFile("too-large.jpg", JPEG, content_type="image/jpeg")},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["results"][0]["status"], "error")
        self.assertIn("storage is full", response.json()["results"][0]["errors"][0])

    @patch("apps.composer.views._create_workspace_media_asset")
    def test_idea_media_upload_returns_a_clear_quota_error(self, create_asset_mock):
        create_asset_mock.side_effect = StorageQuotaExceededError(used=100, limit=100, attempted=1)

        response = self.client.post(
            reverse("composer:idea_upload_media", kwargs={"workspace_id": self.workspace.id}),
            {"file": SimpleUploadedFile("too-large.jpg", JPEG, content_type="image/jpeg")},
        )

        self.assertEqual(response.status_code, 413)
        self.assertIn("storage is full", response.json()["error"])

    def test_composer_upload_rejects_a_forged_image_before_creating_an_asset(self):
        response = self.client.post(
            reverse("composer:upload_media", kwargs={"workspace_id": self.workspace.id}),
            {
                "file": SimpleUploadedFile(
                    "fake.png",
                    b"<html>not an image</html>",
                    content_type="image/png",
                )
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(MediaAsset.objects.filter(workspace=self.workspace).exists())

    def test_thumbnail_upload_rejects_a_forged_image_before_creating_an_asset(self):
        response = self.client.post(
            reverse("composer:thumbnail_upload", kwargs={"workspace_id": self.workspace.id}),
            {
                "file": SimpleUploadedFile(
                    "fake.png",
                    b"<html>not an image</html>",
                    content_type="image/png",
                )
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(MediaAsset.objects.filter(workspace=self.workspace).exists())
