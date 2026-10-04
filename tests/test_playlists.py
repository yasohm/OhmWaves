"""Playlist storage and API tests (temporary database, no network)."""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from playlist_service import PlaylistNotFound, PlaylistService  # noqa: E402


def song(n, **extra):
    return {"videoId": f"vid{n:08d}", "title": f"Song {n}", "artist": "Nova", "album": "Orbit",
            "cover": f"https://lh3.googleusercontent.com/{n}=w544-h544", "duration": "3:00", **extra}


class PlaylistServiceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.service = PlaylistService(db_path=os.path.join(self.tmp.name, "test.db"))

    def tearDown(self):
        self.tmp.cleanup()

    def test_create_with_tracks_keeps_order_and_drops_duplicates(self):
        playlist = self.service.create("me", "  Road   trip ", [song(1), song(2), song(1)])
        self.assertEqual(playlist["name"], "Road trip")
        self.assertEqual([t["videoId"] for t in playlist["tracks"]], [song(1)["videoId"], song(2)["videoId"]])

    def test_add_tracks_appends_and_skips_existing(self):
        playlist = self.service.create("me", "Mix")
        playlist, added = self.service.add_tracks("me", playlist["id"], [song(1), song(2)])
        self.assertEqual(added, 2)
        playlist, added = self.service.add_tracks("me", playlist["id"], [song(2), song(3)])
        self.assertEqual(added, 1)
        self.assertEqual([t["title"] for t in playlist["tracks"]], ["Song 1", "Song 2", "Song 3"])

    def test_remove_track_and_rename(self):
        playlist = self.service.create("me", "Mix", [song(1), song(2)])
        playlist = self.service.remove_track("me", playlist["id"], song(1)["videoId"])
        self.assertEqual([t["title"] for t in playlist["tracks"]], ["Song 2"])
        self.assertEqual(self.service.rename("me", playlist["id"], "Chill")["name"], "Chill")

    def test_delete_removes_tracks_too(self):
        playlist = self.service.create("me", "Mix", [song(1)])
        self.service.delete("me", playlist["id"])
        self.assertEqual(self.service.list_playlists("me"), [])
        with self.service._connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM playlist_tracks").fetchone()[0], 0)

    def test_other_users_cannot_see_or_change_a_playlist(self):
        playlist = self.service.create("me", "Mine", [song(1)])
        self.assertEqual(self.service.list_playlists("someone-else"), [])
        for attempt in (lambda: self.service.rename("someone-else", playlist["id"], "Theirs"),
                        lambda: self.service.delete("someone-else", playlist["id"]),
                        lambda: self.service.add_tracks("someone-else", playlist["id"], [song(2)]),
                        lambda: self.service.remove_track("someone-else", playlist["id"], song(1)["videoId"])):
            with self.assertRaises(PlaylistNotFound):
                attempt()
        self.assertEqual(self.service.get("me", playlist["id"])["name"], "Mine")

    def test_rejects_bad_input(self):
        for name in ("", "   ", None, "x" * 101):
            with self.assertRaises(ValueError):
                self.service.create("me", name)
        playlist = self.service.create("me", "Mix")
        with self.assertRaises(ValueError):
            self.service.add_tracks("me", playlist["id"], [{"videoId": "../etc/passwd", "title": "x"}])
        with self.assertRaises(ValueError):
            self.service.add_tracks("me", playlist["id"], [])

    def test_only_https_covers_are_stored(self):
        playlist = self.service.create("me", "Mix", [song(1, cover="javascript:alert(1)")])
        self.assertIsNone(playlist["tracks"][0]["cover"])


class PlaylistApiTest(unittest.TestCase):
    def setUp(self):
        import app as server
        self.tmp = tempfile.TemporaryDirectory()
        self.original = server.playlists
        server.playlists = PlaylistService(db_path=os.path.join(self.tmp.name, "api.db"))
        self.server = server
        self.client = server.app.test_client()

    def tearDown(self):
        self.server.playlists = self.original
        self.tmp.cleanup()

    def test_full_lifecycle(self):
        created = self.client.post("/api/playlists", json={"user_id": "me", "name": "Gym", "tracks": [song(1)]})
        self.assertEqual(created.status_code, 201)
        playlist_id = created.get_json()["data"]["playlist"]["id"]

        added = self.client.post(f"/api/playlists/{playlist_id}/tracks", json={"user_id": "me", "tracks": [song(2)]})
        self.assertEqual(added.get_json()["data"]["added"], 1)

        renamed = self.client.patch(f"/api/playlists/{playlist_id}", json={"user_id": "me", "name": "Gym 2"})
        self.assertEqual(renamed.get_json()["data"]["playlist"]["name"], "Gym 2")

        removed = self.client.delete(f"/api/playlists/{playlist_id}/tracks/{song(1)['videoId']}", json={"user_id": "me"})
        self.assertEqual(len(removed.get_json()["data"]["playlist"]["tracks"]), 1)

        listed = self.client.get("/api/playlists?user_id=me").get_json()["data"]["playlists"]
        self.assertEqual([p["name"] for p in listed], ["Gym 2"])

        self.assertEqual(self.client.delete(f"/api/playlists/{playlist_id}", json={"user_id": "me"}).status_code, 200)
        self.assertEqual(self.client.get("/api/playlists?user_id=me").get_json()["data"]["playlists"], [])

    def test_errors_are_clear(self):
        missing = self.client.patch("/api/playlists/nope", json={"user_id": "me", "name": "x"})
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(missing.get_json()["error"]["code"], "NOT_FOUND")
        unnamed = self.client.post("/api/playlists", json={"user_id": "me", "name": ""})
        self.assertEqual(unnamed.status_code, 400)
        self.assertEqual(unnamed.get_json()["error"]["message"], "Give your playlist a name.")
        self.assertEqual(self.client.get("/api/playlists?user_id=bad%20id!").status_code, 400)


if __name__ == "__main__":
    unittest.main()
