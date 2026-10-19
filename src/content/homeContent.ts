export interface HomeInfoSection {
  title: string;
  paragraphs: string[];
  imageSrc: string;
  imageAlt: string;
  imageCaption: string;
}

export const HOME_INTRO = {
  description: "Created by experienced Tower Defense players for Tower Defense players.",
  buttonLabel: "Play on Roblox",
  robloxUrl: "https://www.roblox.com/games/80787635946901/Tower-Eclipse",
};

export const HOME_VIDEO = {
  title: "I Spent 2 Years Building the Roblox Tower Defense Game I Wanted to Play",
  url: "https://www.youtube.com/watch?v=T5OH2F6_ik0",
  thumbnailSrc: "/home/game-video.jpg",
};

// Homepage copy and images can be updated here.
export const HOME_INFO_SECTIONS: HomeInfoSection[] = [
  {
    title: "Who are we?",
    paragraphs: [
      "Tower Eclipse is an upcoming Roblox tower defense game planned to release in 2026, designed for players who want more than just a basic tower defense.",
      "Defend Sororterra across Story, Survival, Ranked and custom modes. Each tower, champion, upgrade path and enemy is designed to create meaningful choices.",
    ],
    imageSrc: "/home/render.jpg",
    imageAlt: "A render of the Cadet in Tower Eclipse",
    imageCaption: "Cadet character render.",
  },
  {
    title: "Strategy",
    paragraphs: [
      "Tower Eclipse has been designed by experienced tower defense players with unique towers, two upgrade paths, and champions all created with a focus on strategic depth and usability.",
      "Each tower has its own niche and use case, allowing for a much more diverse and complex meta.",
    ],
    imageSrc: "/home/military-camp-model.png",
    imageAlt: "Military Camp models showing both upgrade paths",
    imageCaption: "Military Camp models across their upgrade paths.",
  },
  {
    title: "Progression",
    paragraphs: [
      "Progression has been designed to reward experienced players rather than simply those who play the longest, minimising the grind while maximising improvement through experience.",
      "Progression ranges from the Research Tree, Towers, Champions, Quests, Achievements, Story, Global Events, Ranked and long-term goals that give players reasons to keep improving.",
    ],
    imageSrc: "/home/progression.jpg",
    imageAlt: "Tower Eclipse champion selection and loadout screen",
    imageCaption: "Champion selection and loadout during development.",
  },
  {
    title: "More ways to play",
    paragraphs: [
      "Tower Eclipse is designed to be more than a single tower defense mode. Players can experience cinematic Story missions, competitive Ranked matches, Open Survival with both path-based and no-path gameplay, global boss takedown events, and community challenges.",
      "Each mode is built with its own mechanics and strategies, giving players more ways to play, create, and master Tower Eclipse.",
    ],
    imageSrc: "/home/subzero-x-1-map.png",
    imageAlt: "Snow-covered terrain and buildings in the Subzero X-1 map",
    imageCaption: "Subzero X-1 map during development.",
  },
];
