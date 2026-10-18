// Internal Dota unit names differ from several displayed hero names.
const overrides = {
  'Queen of Pain': 'queenofpain', "Nature's Prophet": 'furion', Clockwerk: 'rattletrap',
  'Wraith King': 'skeleton_king', Necrophos: 'necrolyte', 'Outworld Destroyer': 'obsidian_destroyer',
  Doom: 'doom_bringer', Timbersaw: 'shredder', Magnus: 'magnataur', Underlord: 'abyssal_underlord',
  'Anti-Mage': 'antimage', 'Shadow Fiend': 'nevermore', 'Vengeful Spirit': 'vengefulspirit',
  Windranger: 'windrunner', Zeus: 'zuus', Lifestealer: 'life_stealer', 'Treant Protector': 'treant',
  Io: 'wisp', 'Centaur Warrunner': 'centaur',
};

export const toHeroSlug = name => overrides[name] || name.toLowerCase()
  .replace(/['.]/g, '').replace(/-/g, '_').replace(/\s+/g, '_');
