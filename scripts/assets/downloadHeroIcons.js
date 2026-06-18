// scripts/assets/downloadHeroIcons.js

import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

const db = new Database("./db/LadsData.db");

const overrides = {
  "Queen of Pain": "queenofpain",
  "Nature's Prophet": "furion",
  "Clockwerk": "rattletrap",
  "Wraith King": "skeleton_king",
  "Necrophos": "necrolyte",
  "Outworld Destroyer": "obsidian_destroyer",
  "Doom": "doom_bringer",
  "Timbersaw": "shredder",
  "Magnus": "magnataur",
  "Underlord": "abyssal_underlord",
  "Anti-Mage": "antimage",
  "Shadow Fiend": "nevermore",
  "Vengeful Spirit": "vengefulspirit",
  "Windranger": "windrunner",
  "Zeus": "zuus",
  "Lifestealer": "life_stealer",
  "Treant Protector": "treant",
  "Io": "wisp",
  "Centaur Warrunner": "centaur"
};

const outputDir = "./client/public/heroes/icons";
fs.mkdirSync(outputDir, { recursive: true });

function toHeroSlug(heroName) {
  if (overrides[heroName]) return overrides[heroName];
  return heroName
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/\./g, "")
    .replace(/-/g, "_")
    .replace(/\s+/g, "_");
}

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
