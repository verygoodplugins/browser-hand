import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name('fix-safari-identifiers.py')
TARGET = 'ai.autojack.browserhand.safari'


class SafariIdentifiersTest(unittest.TestCase):
    def run_fixture(self, name, content):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        project = Path(temp.name)
        settings = project / name
        settings.write_text(content)
        result = subprocess.run([sys.executable, str(SCRIPT), str(project), TARGET], capture_output=True, text=True)
        return result, settings.read_text()

    def test_pbxproj_with_test_targets(self):
        source = '''PRODUCT_BUNDLE_IDENTIFIER = "ai.autojack.browserhand.Browser-Hand.Extension";
PRODUCT_BUNDLE_IDENTIFIER = "ai.autojack.browserhand.Browser-Hand";
PRODUCT_BUNDLE_IDENTIFIER = "ai.autojack.browserhand.Browser-HandTests";
PRODUCT_BUNDLE_IDENTIFIER = "ai.autojack.browserhand.Browser-HandUITests";
'''
        result, content = self.run_fixture('project.pbxproj', source)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('"' + TARGET + '.Extension"', content)
        self.assertIn('"' + TARGET + '"', content)
        self.assertIn('"ai.autojack.browserhand.Browser-HandTests"', content)
        self.assertIn('"ai.autojack.browserhand.Browser-HandUITests"', content)

    def test_xcproj_with_different_host_identifier(self):
        source = '''"PRODUCT_BUNDLE_IDENTIFIER": "ai.autojack.browserhand.Browser-Hand",
"PRODUCT_BUNDLE_IDENTIFIER": "ai.autojack.browserhand.safari.Extension",
'''
        result, content = self.run_fixture('project.xcproj', source)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('"' + TARGET + '",', content)
        self.assertIn('"' + TARGET + '.Extension",', content)

    def test_ambiguous_project_is_not_rewritten(self):
        source = '''PRODUCT_BUNDLE_IDENTIFIER = "example.app";
PRODUCT_BUNDLE_IDENTIFIER = "example.other";
PRODUCT_BUNDLE_IDENTIFIER = "example.app.Extension";
'''
        result, content = self.run_fixture('project.pbxproj', source)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(content, source)


if __name__ == '__main__':
    unittest.main()
