export interface AboutStorySection {
  eyebrow: string;
  title: string;
  byline: string;
  paragraphs: string[];
  images: Array<{
    src: string;
    alt: string;
  }>;
}

export type CreditIcon = "development" | "contributors" | "quality" | "testing" | "supporters";

export interface CreditMember {
  name: string;
  handle: string;
  contribution: string;
}

export interface CreditGroup {
  id: string;
  title: string;
  subtitle: string;
  icon: CreditIcon;
  accent: string;
  members?: CreditMember[];
  acknowledgements?: string[];
  closingNote?: string;
}

export const ABOUT_INTRO = {
  eyebrow: "ECLIPSE DEVELOPMENT STUDIO",
  title: "BUILT TO BE DIFFERENT",
  description:
    "Tower Eclipse is an independent Roblox tower defense project shaped by a love of strategy, worldbuilding, and games that respect the player's time.",
};

export const ABOUT_STORY_SECTIONS: AboutStorySection[] = [
  {
    eyebrow: "",
    title: "MY VISION",
    byline: "By Superstitic",
    paragraphs: [
      "I created Tower Eclipse back in 2024 because I believe the Roblox Tower Defense genre still has a huge amount of unexplored potential.",
      "After playing Roblox tower defense games for years and contributing to some of them I began to notice how often progression could become more important than strategy. Stronger, harder to unlock towers replaced weaker ones and difficult content requires grinding rather than better decisions. Many matches and gamemodes I played felt repetitive strategy wise rather than something you had to think about. Additionally the lack of innovation, experimentation and new content in the genre further motivated me to create something different.",
      "My goal is to create a game where player decisions remain at the centre of the experience. Towers should have genuine strengths, weaknesses, unique mechanics and abilities rather than simply becoming obsolete due to another tower having better / different stats. The dual upgrade path system should change how something is used and not just modify the stats. Systems like Champions, Research, complex enemy abilities and gamemode specific mechanics should give experienced players more opportunities to make meaningful decisions without making the game inaccessible to someone playing for the first time.",
      "Progression in my opinion always should focus more heavily on improving your knowledge and experience as opposed to spending countless hours to unlock new overpowered or limited / exclusive stuff.",
      "To make Tower Eclipse stand out I want to expand further beyond the basic concepts of just “place down towers and defend waves of enemies”. Story Mode, ranked, survival, boss events, seasonal events, defend the center, battlefront, base builder, global events and community created challenges are all different attempts to explore what a tower defense game can become when it expands beyond traditional gameplay.",
      "If Tower Eclipse can give players a game that is easy to understand but hard to master, memorable challenges they have to genuinely think through, a world and story they become invested in and an experience that makes them excited about what the Roblox Tower Defense genre can still become, then it will have achieved what I originally set out to create.",
    ],
    // Add or replace these paths as artwork is ready. Each story card always reserves three wide slots.
    images: [
      { src: "/home/render.jpg", alt: "A render of the tower, Cadet with its weapons facing towards the camera" },
      { src: "/home/subzero-x-1-map.png", alt: "The map Subzero X-1 in game." },
      { src: "/home/military-camp-model.png", alt: "The Military Camp model in blender." },
    ],
  },
  {
    eyebrow: "",
    title: "PROJECT ORIGINS",
    byline: "By Superstitic",
    paragraphs: [
      "Tower Eclipse development began in early 2024 with considerably more ambition than experience.",
      "I had been playing Roblox Tower Defense games since 2017 and had wanted to create one of my own for years. I had even contributed to some existing TD games but I always felt that I needed to know more before I could actually make one myself.",
      "Eventually, I realised that waiting until I felt ready would probably mean never starting at all.",
      "So I opened Roblox Studio for the first time. No team, no budget, no community, just an idea I wanted to create.",
      "At the time, I had never programmed in Luau, modelled a proper tower, designed a complete map or attempted to build a game anywhere close to this scale. The earliest versions of Tower Eclipse showed that clearly. They were buggy, poorly optimised and not particularly fun or replayable. My first map was something I recreated from a building tutorial I was following, and the original placeholder towers barely resemble anything that exists in the game today.",
      "But the early versions proved to me that I could create something, learn from it and that over time I could improve on it.",
      "Every bugged or unoptimised system became something to learn from. As my programming, design and development skills improved, parts of the game that once seemed impressive began to feel limiting. What I was capable of development wise started improving faster than the foundations I had originally created.",
      "Eventually, that meant remaking the entire game from scratch, and I called the new build, Tower Eclipse 2.0.",
      "And then after a while, I did it again. Creating Tower Eclipse 3.0.",
      "As Tower Eclipse gradually stopped being a small tower defense project a community began to form around it. Testers joined the project and I contracted developers to work on parts of the game.",
      "As of August 2026, I have spent over 2,000 hours developing Tower Eclipse and invested more than $2,500 of my own money into the project, all with the goal of creating something I can genuinely be proud of and that other people can enjoy.",
      "Over time I’ve met so many awesome people that have helped shape the project into what it is today. Without my testing team, fellow developers and volunteer contributors Tower Eclipse would look very different from the game it is now.",
      "Currently, development is still ongoing. The project has changed massively since the first versions in Roblox Studio all the way back in 2024, and it will continue changing as I learn more and discover ways to improve it.",
      "My original goal however, has remained surprisingly consistent.",
      "Make something you’re proud of that is worth playing."
    ],
    // Add or replace these paths as artwork is ready. Each story card always reserves three wide slots.
    images: [
      { src: "/home/version1.jpg", alt: "An image of the original version of the project back from v1.0 in 2024" },
      { src: "/home/mech-center-leak.png", alt: "An image of the ETF Mech Center model in blender." },
      { src: "/home/overlord.png", alt: "An image of the Overlord model in blender." },
    ],
  },
];

export const ABOUT_CREDITS = {
  eyebrow: "THE PEOPLE THAT MADE THIS PROJECT POSSIBLE",
  title: "CREDITS",
  message:
    "Our deepest gratitude goes to everyone who has contributed time, ideas, feedback, and support to Tower Eclipse.",
  thankYou:
    "And a huge thank you to every player supporting the project and joining us on the journey.",
  backgroundImage: "/home/who-are-we.jpg",
};

export const CREDIT_GROUPS: CreditGroup[] = [
  {
    id: "development",
    title: "Developers",
    subtitle: "The core team building Tower Eclipse",
    icon: "development",
    acknowledgements: ["Primary team", "Largest contributions"],
    accent: "#27b9ff",
    members: [
      {
        name: "superstitic",
        handle: "@Superstitic",
        contribution: "Owner, Scripter, Design Team",
      },
      {
        name: "koilafaitdon",
        handle: "@JeanschezAuchan",
        contribution: "Scripter",
      },
      {
        name: "fartom",
        handle: "@HolyBlack_Phantom",
        contribution: "UI Designer",
      },
    ],
  },
  {
    id: "contributors",
    title: "Contributors",
    subtitle: "Contractors and long standing former QA testers",
    icon: "contributors",
    accent: "#20e0af",
    acknowledgements: ["Contractors", "Distinguished former QA"],
    closingNote: "",
    members: [
      {
        name: "grandiloquentcy",
        handle: "@discomaster30",
        contribution: "Tower Concept Design",
      },
      {
        name: "jaem_",
        handle: "@Jaem_D",
        contribution: "9 Tower Models",
      },
      {
        name: "crethoptic",
        handle: "@Crethopic",
        contribution: "3 Maps",
      },
      {
        name: "noxrimz",
        handle: "@Norxrilm",
        contribution: "VFX",
      },
      {
        name: "darkywi",
        handle: "@Danielrive",
        contribution: "Upgrade Icons, 3 Maps",
      },
      {
        name: "linxthedeveloper",
        handle: "@supereroulnoptizet",
        contribution: "X+ Maps, 2 Tower Models, Concept Art",
      },
      {
        name: "railrunner.",
        handle: "@RaiIRunner",
        contribution: "2 Tower Models, X+ Enemy Models",
      },
      {
        name: "vengeful_rivynant",
        handle: "@gleba1706",
        contribution: "Website, Tower Rigs",
      },
      {
        name: "drbobrossx",
        handle: "@Cityscar",
        contribution: "2 Maps, Story Map Concepts",
      },
      {
        name: "hakerski",
        handle: "@hgjoooo",
        contribution: "2 Maps",
      },
      {
        name: "flowithlyn",
        handle: "@Flowithlyn",
        contribution: "Dark Knight Soundtrack",
      },
      {
        name: "luomixer",
        handle: "@?",
        contribution: "Triumph Soundtrack",
      },
      {
        name: ".gviper",
        handle: "@?",
        contribution: "X Enemy Models",
      },
      {
        name: "unknown_person_3",
        handle: "@mati123roblo",
        contribution: "1 Tower Model",
      },
      {
        name: "rompeglv",
        handle: "@elrompeotro",
        contribution: "Distinguished Former QA Tester, 1 Map",
      },
      {
        name: "thatguyreborn",
        handle: "@lThat_Guy23l",
        contribution: "Distinguished Former QA Tester",
      },
      {
        name: "mayreborn",
        handle: "@larkosansi",
        contribution: "Early Scripting",
      },
      {
        name: "_rosebush",
        handle: "@brookee_bellaa",
        contribution: "Business Plan",
      },
      {
        name: "henniepokki",
        handle: "@henpokpok",
        contribution: "Story Drafting, Concept Art",
      },
      {
        name: "lexdros8888",
        handle: "@?",
        contribution: "Placeholder Maps",
      },
      {
        name: "blueguy1011.",
        handle: "@BlueGuyDev11231",
        contribution: "Aegis Animations",
      },
    ],
  },
  {
    id: "testing",
    title: "QA Testers",
    subtitle: "Helping every release reach a higher standard. (6+ months only)",
    icon: "testing",
    accent: "#b682ff",
    acknowledgements: ["Bug hunting", "Balance feedback", "Release checks"],
    closingNote: "",
    members: [
      {
        name: "realcatpfp",
        handle: "@NooB_IzGame",
        contribution: "Joined 07/12/24",
      },
      {
        name: "drbobrossx",
        handle: "@CityScar",
        contribution: "Joined 29/01/25",
      },
      {
        name: "ynot2f9",
        handle: "@lukas37F",
        contribution: "Joined 29/01/25",
      },
      {
        name: "anoobwithnolifesed_",
        handle: "@anoobwithnolifesed",
        contribution: "Joined 01/02/25",
      },
      {
        name: "mesttpsuper",
        handle: "@MestTPsuper",
        contribution: "Joined 15/11/25",
      },
      {
        name: "spiritgamerpro_1",
        handle: "@SpiritGamerPro1",
        contribution: "Joined 15/11/25",
      },
      {
        name: "fidgetlord2",
        handle: "@Fidgetlord2",
        contribution: "Joined 15/11/25",
      },
      {
        name: "lemener",
        handle: "@lemener36A",
        contribution: "Joined 08/01/26",
      },
      {
        name: "vengeful_rivynant",
        handle: "@gleba1706",
        contribution: "Joined 08/01/26",
      },
      {
        name: "blockbusterX",
        handle: "@blocbusterx",
        contribution: "Joined 08/01/26",
      },
    ],
  },
  {
    id: "lead-quality",
    title: "QA Lead",
    subtitle: "Leading the testing team and game quality",
    icon: "quality",
    accent: "#ff4c8b",
    members: [
      {
        name: "Zoxlon",
        handle: "@Zoxlon",
        contribution: "Joined 29/01/25",
      },
      {
        name: "EvanIsSilly",
        handle: "@EvanIsSilly",
        contribution: "Joined 29/01/25",
      },
    ],
  },
  {
    id: "supporters",
    title: "Early Supporters",
    subtitle: "Backing Tower Eclipse from its earliest stages",
    icon: "supporters",
    accent: "#ffbb22",
    acknowledgements: ["Notable suggesters", "Patreon members", "Early donators"],
    closingNote: "",
    members: [
      {
        name: "hiyoko8458",
        handle: "@Hiyokaha",
        contribution: "MANIAC Donator",
      },
      {
        name: "infinitelolzforever",
        handle: "@InfiniteLolzForever",
        contribution: "MANIAC Donator",
      },
      {
        name: "thatonekoolaid_drinker",
        handle: "@Kool_aiddwashere",
        contribution: "MANIAC Donator",
      },
      {
        name: "realdud65",
        handle: "@realdud65",
        contribution: "MANIAC Donator",
      },
      {
        name: "rpgenjoyer1",
        handle: "@basicbattler137",
        contribution: "MANIAC Donator",
      },
      {
        name: "anoobwithnolifesed_",
        handle: "@anoobwithnolifesed",
        contribution: "Patreon Member (Survivor)",
      },
      {
        name: "blocbusterx",
        handle: "@blocbusterX",
        contribution: "Early Supporter",
      },
      {
        name: "ynot2f9",
        handle: "@lukas37F",
        contribution: "Early Supporter",
      },
    ],
  },
];
