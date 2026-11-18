#!/usr/bin/env python3
"""Normalize only the generated Safari app and extension identifiers."""
from pathlib import Path
import re
import sys

project = Path(sys.argv[1])
bundle_id = sys.argv[2]
pattern = re.compile(
    r'(?P<prefix>"?PRODUCT_BUNDLE_IDENTIFIER"?\s*[:=]\s*"?)'
    r'(?P<value>[A-Za-z0-9.-]+)(?P<suffix>"?\s*[,;])'
)
for name in ('project.xcproj', 'project.pbxproj'):
    path = project / name
    if path.exists():
        content = path.read_text()
        ids = {match.group('value') for match in pattern.finditer(content)}
        extensions = {item for item in ids if item.endswith('.Extension')}
        hosts = {item for item in ids if item not in extensions and not item.endswith(('Tests', 'UITests'))}
        if len(extensions) != 1 or len(hosts) != 1:
            raise SystemExit('Could not safely identify generated app and extension bundle identifiers')
        replacements = {hosts.pop(): bundle_id, extensions.pop(): bundle_id + '.Extension'}
        content = pattern.sub(
            lambda match: match.group('prefix') + replacements.get(match.group('value'), match.group('value')) + match.group('suffix'),
            content,
        )
        path.write_text(content)
        break
else:
    raise SystemExit('Cannot find the generated Xcode project settings')
