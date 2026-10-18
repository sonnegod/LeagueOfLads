// scripts/assets/downloadHeroIcons.js

import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { toHeroSlug } from "../../config/heroNames.js";

const db = new Database("./db/LadsData.db");

const outputDir = "./client/public/heroes/icons";
fs.mkdirSync(outputDir, { recursive: true });

const heroes = db
  .prepare(`SELECT HeroId, HeroName FROM HeroInfo ORDER BY HeroId`)
  .all();

for (const hero of heroes) {
  const slug = toHeroSlug(hero.HeroName);
const url =
  `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/icons/${slug}.png`;
    const filePath = path.join(outputDir, `${hero.HeroId}.png`);

  try {
    const res = await fetch(url);

    if (!res.ok) {
      console.log(`FAILED ${hero.HeroId} ${hero.HeroName}: ${url}`);
      continue;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(filePath, buffer);

    console.log(`Saved ${hero.HeroId} ${hero.HeroName} -> ${filePath}`);
  } catch (err) {
    console.log(`ERROR ${hero.HeroId} ${hero.HeroName}: ${err.message}`);
  }
}

db.close();
