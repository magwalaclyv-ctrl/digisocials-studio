import pytest
from django.utils import timezone

from apps.accounts.models import User
from apps.media_library.storage import reset_cached_client
from apps.members.models import OrgMembership
from apps.organizations.models import Organization


@pytest.fixture
def user(db):
    return User.objects.create_user(
        email="test@example.com",
        password="test-password",
        name="Test User",
        tos_accepted_at=timezone.now(),
    )


@pytest.fixture
def organization(db):
    return Organization.objects.create(name="Test Organization")


@pytest.fixture
def org_owner(db, user, organization):
    OrgMembership.objects.create(user=user, organization=organization, org_role=OrgMembership.OrgRole.OWNER)
    return user


@pytest.fixture(autouse=True)
def _fresh_storage_client():
    reset_cached_client()
    yield
    reset_cached_client()
