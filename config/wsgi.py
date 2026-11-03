"""
WSGI config for config project.

It exposes the WSGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/5.2/howto/deployment/wsgi/
"""

import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

application = get_wsgi_application()

from django.conf import settings  # noqa: E402

if settings.PREVIEW_SQLITE and not os.path.exists(settings.DATABASES['default']['NAME']):
    from django.core.management import call_command
    call_command('migrate', verbosity=0)
    call_command('seed')

app = application  # nama yang dicari runtime Python Vercel
