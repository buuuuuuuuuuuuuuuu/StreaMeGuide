// Temporär: sucht die fehlenden Sender aus der o2-Liste
import { gunzipSync } from "node:zlib";
const want = /super ?rtl|\bhr\b|hessen|cirkus|bbc|cnn|kika|nick|n24|\bbr\b|bayer|mdr|ndr|bremen|\bsr\b|saarl|swr|wdr|df1|\btlc\b|duck|\bric\b|toggo|arthouse|cnma|artflix|bloody|cinema|hearts|rbb/i;
for (const url of ["https://epgshare01.online/epgshare01/epg_ripper_DE1.xml.gz", "https://iptv-epg.org/files/epg-de.xml.gz"]) {
  const res = await fetch(url); let buf = Buffer.from(await res.arrayBuffer());
  if (buf[0] === 0x1f) buf = gunzipSync(buf);
  const xml = buf.toString("utf8");
  const counts = new Map();
  for (const m of xml.matchAll(/<programme[^>]*channel="([^"]+)"/g)) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
  console.log(`\n=== ${url}`);
  for (const m of xml.matchAll(/<channel id="([^"]+)">[\s\S]*?<display-name[^>]*>([^<]*)<\/display-name>/g)) {
    if (!want.test(m[1] + " " + m[2])) continue;
    console.log(`  ${m[1].padEnd(34)} ${m[2].padEnd(34)} ${counts.get(m[1]) || 0}`);
  }
}
