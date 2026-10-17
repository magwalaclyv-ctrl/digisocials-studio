from urllib.parse import urlsplit

from django.conf import settings
from django.db import migrations


def set_site(apps, schema_editor):
    Site = apps.get_model("sites", "Site")
    parsed_url = urlsplit(settings.APP_URL)
    domain = parsed_url.netloc or parsed_url.path.strip("/")
    Site.objects.update_or_create(
        id=1,
        defaults={"domain": domain or "localhost", "name": "DigiSocials"},
    )


def reset_site(apps, schema_editor):
    Site = apps.get_model("sites", "Site")
    Site.objects.filter(id=1).update(domain="studio.brightbean.xyz", name="Brightbean")


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0005_add_review_banner_dismissed_at"),
    ]

    operations = [migrations.RunPython(set_site, reset_site)]
