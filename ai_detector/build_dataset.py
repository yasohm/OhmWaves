"""
Collect labelled training data: python -m ai_detector.build_dataset --ai 400 --human 400

Only features are kept (about 14 KB per song); the audio clips are discarded. Re-running continues where it
stopped, so it can be interrupted safely.
"""
import argparse
import json
import os
import threading
from concurrent.futures import ThreadPoolExecutor

import numpy as np

from .audio import fetch_clip
from .features import fakeprint
from .sources import ai_candidates, human_candidates, load_ai_artists

DATA_DIR = os.environ.get("OHMWAVE_AI_DATA", "data/ai_detector")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ai", type=int, default=400, help="AI songs to collect")
    parser.add_argument("--human", type=int, default=400, help="human songs to collect")
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()

    from yt_music_scraper import YTMusicScraper  # imported late: it sets up YouTube Music clients
    scraper = YTMusicScraper(download_dir=os.path.join(DATA_DIR, "tmp"))
    features_dir = os.path.join(DATA_DIR, "features")
    os.makedirs(features_dir, exist_ok=True)
    manifest_path = os.path.join(DATA_DIR, "manifest.jsonl")

    done, failed = {}, set()
    if os.path.exists(manifest_path):
        with open(manifest_path) as handle:
            for line in handle:
                row = json.loads(line)
                (failed.add(row["videoId"]) if row.get("error") else done.__setitem__(row["videoId"], row))
    counts = {0: sum(1 for r in done.values() if r["label"] == 0), 1: sum(1 for r in done.values() if r["label"] == 1)}
    print(f"Already have {counts[1]} AI and {counts[0]} human songs.")

    artists = load_ai_artists()
    ai_channels = {a["channel"] for a in artists}
    print(f"{len(artists)} AI artists with a YouTube channel.")
    lock = threading.Lock()
    in_flight = threading.BoundedSemaphore(args.workers + 2)  # don't queue far more songs than we still need

    def collect(candidate):
        try:
            collect_one(candidate)
        finally:
            in_flight.release()

    def collect_one(candidate):
        with lock:
            if counts[candidate["label"]] >= (args.ai if candidate["label"] else args.human):
                return
        row = dict(candidate)
        try:
            vector = fakeprint(fetch_clip(scraper, candidate["videoId"]))
            np.save(os.path.join(features_dir, f"{candidate['videoId']}.npy"), vector)
        except Exception as exc:
            row["error"] = str(exc)[:300]
        with lock:
            with open(manifest_path, "a") as handle:
                handle.write(json.dumps(row) + "\n")
            if "error" not in row:
                counts[row["label"]] += 1
                print(f"[{counts[1]:>4} AI | {counts[0]:>4} human] {'AI   ' if row['label'] else 'human'} "
                      f"{row['artist'][:28]:<28} {row['title'][:40]}", flush=True)
            else:
                print(f"  skipped {row['videoId']}: {row['error'][:100]}", flush=True)

    def feed(candidates, label, target):
        with ThreadPoolExecutor(max_workers=max(1, args.workers // 2)) as pool:
            for candidate in candidates:
                with lock:
                    if counts[label] >= target:
                        break
                if candidate["videoId"] in done or candidate["videoId"] in failed:
                    continue
                done[candidate["videoId"]] = candidate
                in_flight.acquire()
                pool.submit(collect, candidate)

    # Both kinds at once, so a usable (balanced) dataset exists early even if collection is stopped.
    feeders = [threading.Thread(target=feed, args=(ai_candidates(scraper.ytmusic, artists), 1, args.ai)),
               threading.Thread(target=feed, args=(human_candidates(scraper.ytmusic, ai_channels), 0, args.human))]
    for thread in feeders:
        thread.start()
    for thread in feeders:
        thread.join()
    print(f"Done: {counts[1]} AI and {counts[0]} human songs in {DATA_DIR}.")


if __name__ == "__main__":
    main()
