export interface HomeInfoSection {
  title: string;
  paragraphs: string[];
  imageSrc: string;
  imageAlt: string;
}

export const HOME_INTRO = {
  kicker: "ROBLOX TOWER DEFENSE",
  title: "TOWER ECLIPSE",
  description: "Created by experienced Tower Defense players for Tower Defense players.",
  buttonLabel: "PLAY ON ROBLOX",
  robloxUrl: "https://www.roblox.com/games/80787635946901/Tower-Eclipse",
};

// can edit like the content and images here, might change to videos later but idk how to do that so yeah
export const HOME_INFO_SECTIONS: HomeInfoSection[] = [
  {
    title: "WHO ARE WE?",
    paragraphs: [
      "Tower Eclipse is an upcoming Roblox tower defense game planned to release in 2026, designed for players who want more than just a basic tower defense.",
      "Defend Sororterra across Story, Survival, Ranked and custom modes, with each tower, champion, upgrade path, enemy, and game mode designed to create meaningful choices. Tower Eclipse aims to provide something more than just a basic wave defense and deliver a more polished, long-term tower defense experience.",
    ],
    imageSrc: "/home/who-are-we.jpg",
    imageAlt: "Tower Eclipse gameplay and world overview",
  },
  {
    title: "STRATEGY",
    paragraphs: [
      "Tower Eclipse has been designed by experienced tower defense players with unique towers, two upgrade paths, and champions all created with a focus on strategic depth and usability.",
      "Each tower has its own niche and use case, allowing for a much more diverse and complex meta.",
    ],
    imageSrc: "/home/strategy.jpg",
    imageAlt: "Tower Eclipse towers defending against an enemy wave",
  },
  {
    title: "PROGRESSION",
    paragraphs: [
      "Progression has been designed to reward experienced players rather than simply those who play the longest, minimising the grind while maximising improvement through experience.",
      "Progression ranges from the Research Tree, Towers, Champions, Quests, Achievements, Story, Global Events, Ranked and long-term goals that give players reasons to keep improving.",
    ],
    imageSrc: "/home/progression.jpg",
    imageAlt: "Tower Eclipse progression and research systems",
  },
  {
    title: "INNOVATION",
    paragraphs: [
      "Tower Eclipse is designed to be more than a single tower defense mode. Players can experience cinematic Story missions, competitive Ranked matches, Open Survival with both path-based and no-path gameplay, global boss takedown events, and community challenges.",
      "Each mode is built with its own mechanics and strategies, giving players more ways to play, create, and master Tower Eclipse.",
    ],
    imageSrc: "/home/innovation.jpg",
    imageAlt: "A cinematic Tower Eclipse game mode",
  },
];
