import hashlib
import unittest

from upload_photo import detect_type, photo_key, sql_quote


class PhotoKey(unittest.TestCase):
    def test_slug_and_hash(self):
        key = photo_key("Weihnachtsmarkt am Gendarmenmarkt", b"abc", "jpg")
        h = hashlib.sha256(b"abc").hexdigest()[:8]
        self.assertEqual(key, f"weihnachtsmarkt-am-gendarmenmarkt-{h}.jpg")

    def test_umlauts_and_eszett_like_js_slug(self):
        self.assertTrue(photo_key("Märkte Straße", b"x", "webp").startswith("markte-strasse-"))

    def test_key_matches_worker_regex(self):
        import re
        self.assertRegex(photo_key("Glühwald am Uber Platz!", b"x", "jpg"), r"^[a-z0-9-]+\.(jpg|webp)$")


class DetectType(unittest.TestCase):
    def test_jpeg(self):
        self.assertEqual(detect_type(b"\xff\xd8\xff\xe0\x00\x10JFIF"), "jpg")

    def test_webp(self):
        self.assertEqual(detect_type(b"RIFF\x00\x00\x00\x00WEBPVP8 "), "webp")

    def test_rejects_png_and_empty(self):
        self.assertIsNone(detect_type(b"\x89PNG\r\n\x1a\n"))
        self.assertIsNone(detect_type(b""))


class SqlQuote(unittest.TestCase):
    def test_doubles_single_quotes(self):
        self.assertEqual(sql_quote("O'Brien <b>"), "'O''Brien <b>'")


if __name__ == "__main__":
    unittest.main()
