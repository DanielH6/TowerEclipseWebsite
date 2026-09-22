// Delivered only by authenticated staff routes; private resource links are not bundled into the public client.
export const onboarding = {
  version: '2026-09-23',
  intro: 'Welcome to the Tower Eclipse testing program. Use this guide to get ready, run purposeful tests, and give the team evidence they can act on. Ask a QA Lead whenever something is unclear.',
  steps: [
    { id: 'expectations', title: 'Read the rules and expectations', paragraphs: [
      'Keep insider information, sensitive documents, exploits, bugs, and unannounced or approved suggestions within authorized team channels. Owner approval is required before sharing them with the public or another game, server, or person. Public website bug reports are not a confidential channel: send security exploits or sensitive logs directly to a QA Lead or developer through an approved private channel.',
      'The Discord rules state that unauthorized leaking can lead to a permanent game and community blacklist, IP bans, a full game-data wipe, removal from credits and leaderboards, and a one-year wait before an appeal. An approved appeal does not guarantee data restoration. These are team rules; this website does not perform those sanctions.',
      'Be self-sufficient: actively test systems and provide meaningful feedback. Simply playing without recording useful findings does not meet the role’s purpose. Keep feedback respectful, specific, and focused on the player experience.'
    ], bullets: ['Keep up with testing-updates, testing-polls, and sessions in Discord.', 'Use balancing-feedback and tester-suggestions for feedback and ideas.', 'Ask a QA Lead about access, uncertain rules, or anything missing from this guide.'] },
    { id: 'access', title: 'Check your access and resources', paragraphs: ['Sign in with Discord and confirm your QA rank on your Account page. Use Re-check Discord Role if a recent rank change is missing. Resource access may still require permission from the document owner. The website bug tracker is the current reporting system; the old spreadsheet is an archive.'], links: [
      ['Current game', 'https://www.roblox.com/games/80787635946901/Tower-Eclipse'], ['Bug tracker', '/bugs'], ['Wiki — ask a QA Lead about contributing', 'https://tower-eclipse.fandom.com/wiki/Tower_Eclipse_Wiki'],
      ['Balancing sheet', 'https://docs.google.com/spreadsheets/d/1qPpsZqC0bCYMdZEjh6FxR_iUKW_3VpRS52D5vva5Kh8/edit?gid=593285758#gid=593285758'],
      ['Upcoming updates', 'https://docs.google.com/document/d/1WowXJLkNEhhEe3tNJ9XyDMHc7pZexTEwp0EGmX_z15I/edit'],
      ['Legacy bug-report spreadsheet', 'https://docs.google.com/spreadsheets/d/1Yg9s6EG760T0GoW1TyF9sJ8ZXYgqCWX5D7mq77oFSpE/edit?gid=1117954726#gid=1117954726'],
      ['Towers document', 'https://docs.google.com/document/d/1O80gOvy18RHo3YpRxKRFuSufXhDfdGfCVPrdvdTxGFs/edit'],
      ['Game OST', 'https://www.youtube.com/playlist?list=PLci7x9OEkUlrBZZw3qdgdCdmHBk2kk2kH'],
      ['Story document', 'https://docs.google.com/document/d/1Smh4Pe2aIymGsIf7aw7weHVULwKyNKAc6lpu7gl4jHE/edit?tab=t.12hr8t9dp401']
    ] },
    { id: 'reporting', title: 'Learn to write an actionable bug report', paragraphs: [
      'Search existing reports and check the suggested related reports before submitting. Add useful reproduction details or evidence to an existing matching report when appropriate. If you are unsure whether it is the same problem, submit your findings and explain the possible connection. QA leads and developers can link duplicates without removing the original report or its author credit.',
      'In the description, state what you did, what actually happened, what you expected, and numbered reproduction steps. Include relevant map, tower, upgrade, wave, device, and whether Testmode was enabled. One distinct issue per report is easier to investigate.',
      'Use the version you actually tested, not a version copied from an old guide. Category and version capture the game area and build; explain any ambiguity in the description. For a Survival issue reproduced with Testmode, mention both Survival and Testmode even if only one category fits.',
      'Frequency is separate from severity: Low means rare, Medium means intermittent, and High means consistent or nearly every attempt. If possible, state the number of successful reproductions, such as 3 out of 5 attempts. Leave frequency unspecified if you do not know.'
    ], bullets: ['Low priority: minor visual/audio defects or small gameplay inconvenience.', 'Medium priority: a noticeable gameplay problem that does not block core play.', 'High priority: a major gameplay disruption, such as failing to load a map.', 'Critical priority: blocked core gameplay, progression or purchase inaccuracies, or unintended reward/progression grants.', 'Ask a QA Lead if uncertain. A rare progression loss can still be Critical. Avoid including private information in public reports.'] },
    { id: 'testmode', title: 'Use Testmode responsibly', paragraphs: [
      'In the lobby, press ; and run testmode enable, or use Enable Testmode on mobile. In-game, F2 opens admin commands. The in-game console menu also provides tower placement and enemy spawning tools.',
      'Testmode disables rewards. Disable it when finished; verify normal progression separately with Testmode off when that is the purpose of the test. Follow the current in-game command help if an interface or argument has changed.'
    ], bullets: ['setcash — set a player’s cash; spawn — spawn an enemy; void — remove all enemies or a specified type.', 'setbasehealth — change base health; speed — choose game speed from 0 to 5.', 'givetower — give a player a loadout tower; ByPassPlacement — change a tower placement limit.', 'setwave — queue a wave after the current wave finishes spawning.', 'ForceRender — re-render enemies and towers for clients; FlyMode — enable flying.', 'Announcement sends to every server. Do not use it for experimentation; follow owner/lead instructions and never abuse it.'] },
    { id: 'console', title: 'Capture useful evidence and server-console output', paragraphs: [
      'When a bug occurs, open the Console button at the bottom left, choose Report, then Create Console Copy. Copy the generated Pastebin link into the optional Server console field of the bug report.',
      'Keep evidence focused: show the before/after behavior, relevant interface, and the circumstances needed to reproduce it. Review logs and screenshots for private information before adding them to a public report. Do not post tokens, passwords, private messages, or sensitive exploit details. Ask a QA Lead how to share sensitive evidence privately.'
    ] },
    { id: 'feedback', title: 'Practice useful feedback and retesting', paragraphs: [
      'Describe the observation first, then explain why it matters to players. Separate facts from guesses. Offer a possible solution or experiment when you have one, while leaving room for a different fix.',
      'For balancing feedback, include the setup, cost, upgrades, mode, wave/enemies, and comparisons that support your conclusion. “This feels weak” becomes useful when paired with an example and a proposed change to test.',
      'When asked to retest a fix, repeat the original steps on the specified version, check a nearby edge case, and report pass/fail with evidence. If the problem remains, explain what changed and what still fails. Mark this checklist complete only after reviewing the material; it records self-reported onboarding, not certification by a lead.'
    ] }
  ],
  archives: [
    ['Current version (2026)', '80787635946901'], ['Early Halloween update — September 2025', '89265181456052'], ['Mastery Mode update — August 2025', '80998683320197'], ['Hard Mode update — April 2025', '95116468418204'], ['Normal Mode update — March 2025', '106747075477647'], ['Tower Eclipse 2.0 — 2025 (date uncertain)', '106406047892021'], ['Tower Eclipse 1.0 — March 2024', '17716599793']
  ]
};
