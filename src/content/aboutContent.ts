export interface AboutStorySection {
  eyebrow: string;
  title: string;
  byline: string;
  paragraphs: string[];
  imageSrc: string;
  imageAlt: string;
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
  title: "BUILT ON PASSION",
  description:
    "Tower Eclipse is an independent Roblox tower defense project shaped by a love of strategy, worldbuilding, and games that respect the player's time.",
};

export const ABOUT_STORY_SECTIONS: AboutStorySection[] = [
  {
    eyebrow: "WHY WE'RE BUILDING",
    title: "MY VISION",
    byline: "By Superstitic",
    paragraphs: [
      "COMING SOON",
      "COMING SOON",
    ],
    imageSrc: "/home/render.jpg",
    imageAlt: "A render of the tower, Cadet with its weapons facing towards the camera",
  },
  {
    eyebrow: "WHERE IT STARTED",
    title: "PROJECT ORIGINS",
    byline: "By Superstitic",
    paragraphs: [
      "COMING SOON",
      "COMING SOON",
    ],
    imageSrc: "/home/version1.jpg",
    imageAlt: "An image of the original version of the project back from v1.0 in 2024",
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
