/**
 * Share Message Templates
 * Extensible template system for milestone celebration messages.
 * Easy to add more categories/templates - just add objects to the array.
 */

export interface MessageTemplate {
  id: string;
  category: string;
  template: string;
  tags: string[]; // For filtering (e.g., "first", "completion", "streak")
}

// === TEMPLATE CATEGORIES ===
// Each category has 8-15 templates for variety (Variable Rewards pattern)

export const TEMPLATES: MessageTemplate[] = [
  // --- CELEBRATORY (15) ---
  {
    id: "cel-1",
    category: "celebratory",
    template: "Just hit {achievement}! 🎉",
    tags: ["general"],
  },
  {
    id: "cel-2",
    category: "celebratory",
    template: "{achievement}! Let's go! 🚀",
    tags: ["general"],
  },
  {
    id: "cel-3",
    category: "celebratory",
    template: "Boom! {achievement} ✓",
    tags: ["general"],
  },
  {
    id: "cel-4",
    category: "celebratory",
    template: "{achievement} — crushed it! 💪",
    tags: ["general"],
  },
  {
    id: "cel-5",
    category: "celebratory",
    template: "Achievement unlocked: {achievement}",
    tags: ["general"],
  },
  {
    id: "cel-6",
    category: "celebratory",
    template: "New milestone: {achievement}! 🏆",
    tags: ["general"],
  },
  {
    id: "cel-7",
    category: "celebratory",
    template: "{achievement}! One step closer.",
    tags: ["general"],
  },
  {
    id: "cel-8",
    category: "celebratory",
    template: "Just ticked off {achievement}!",
    tags: ["general"],
  },
  {
    id: "cel-9",
    category: "celebratory",
    template: "{achievement} — feels good!",
    tags: ["general"],
  },
  {
    id: "cel-10",
    category: "celebratory",
    template: "Level up: {achievement} complete!",
    tags: ["general"],
  },
  {
    id: "cel-11",
    category: "celebratory",
    template: "🎯 {achievement}",
    tags: ["general"],
  },
  {
    id: "cel-12",
    category: "celebratory",
    template: "Nailed it! {achievement}",
    tags: ["general"],
  },
  {
    id: "cel-13",
    category: "celebratory",
    template: "{achievement}! Keep the momentum going.",
    tags: ["general"],
  },
  {
    id: "cel-14",
    category: "celebratory",
    template: "Another one down: {achievement}",
    tags: ["general"],
  },
  {
    id: "cel-15",
    category: "celebratory",
    template: "{achievement} ✅",
    tags: ["general"],
  },

  // --- CASUAL (12) ---
  {
    id: "cas-1",
    category: "casual",
    template: "{achievement}. Cool.",
    tags: ["general"],
  },
  {
    id: "cas-2",
    category: "casual",
    template: "{achievement}. Not bad.",
    tags: ["general"],
  },
  {
    id: "cas-3",
    category: "casual",
    template: "Oh look, {achievement}.",
    tags: ["general"],
  },
  {
    id: "cas-4",
    category: "casual",
    template: "{achievement}. Moving on.",
    tags: ["general"],
  },
  {
    id: "cas-5",
    category: "casual",
    template: "Done: {achievement}",
    tags: ["general"],
  },
  {
    id: "cas-6",
    category: "casual",
    template: "{achievement}. ✓",
    tags: ["general"],
  },
  {
    id: "cas-7",
    category: "casual",
    template: "Apparently I did {achievement}.",
    tags: ["general"],
  },
  {
    id: "cas-8",
    category: "casual",
    template: "{achievement}. Neat.",
    tags: ["general"],
  },
  {
    id: "cas-9",
    category: "casual",
    template: "Today: {achievement}",
    tags: ["general"],
  },
  {
    id: "cas-10",
    category: "casual",
    template: "{achievement}. That happened.",
    tags: ["general"],
  },
  {
    id: "cas-11",
    category: "casual",
    template: "Check. {achievement}.",
    tags: ["general"],
  },
  {
    id: "cas-12",
    category: "casual",
    template: "{achievement}. Next?",
    tags: ["general"],
  },

  // --- PROUD (12) ---
  {
    id: "prd-1",
    category: "proud",
    template: "Worked hard for this: {achievement}",
    tags: ["general"],
  },
  {
    id: "prd-2",
    category: "proud",
    template: "Proud moment: {achievement}",
    tags: ["general"],
  },
  {
    id: "prd-3",
    category: "proud",
    template: "{achievement} — earned it!",
    tags: ["general"],
  },
  {
    id: "prd-4",
    category: "proud",
    template: "Put in the miles, got the reward: {achievement}",
    tags: ["general"],
  },
  {
    id: "prd-5",
    category: "proud",
    template: "Hard work pays off: {achievement}",
    tags: ["general"],
  },
  {
    id: "prd-6",
    category: "proud",
    template: "{achievement}. Every step counted.",
    tags: ["general"],
  },
  {
    id: "prd-7",
    category: "proud",
    template: "This one means something: {achievement}",
    tags: ["general"],
  },
  {
    id: "prd-8",
    category: "proud",
    template: "{achievement} — no shortcuts.",
    tags: ["general"],
  },
  {
    id: "prd-9",
    category: "proud",
    template: "Consistency delivered: {achievement}",
    tags: ["general"],
  },
  {
    id: "prd-10",
    category: "proud",
    template: "{achievement}. I showed up.",
    tags: ["general"],
  },
  {
    id: "prd-11",
    category: "proud",
    template: "From effort to achievement: {achievement}",
    tags: ["general"],
  },
  {
    id: "prd-12",
    category: "proud",
    template: "{achievement}. Built one run at a time.",
    tags: ["general"],
  },

  // --- FIRST MILESTONE (10) ---
  {
    id: "fst-1",
    category: "first",
    template: "First street done! Many more to go. 🏃",
    tags: ["first"],
  },
  {
    id: "fst-2",
    category: "first",
    template: "And so it begins! First street in {project}.",
    tags: ["first"],
  },
  {
    id: "fst-3",
    category: "first",
    template: "The journey starts: first street in {project} ✓",
    tags: ["first"],
  },
  {
    id: "fst-4",
    category: "first",
    template: "One down, {remaining} to go in {project}!",
    tags: ["first"],
  },
  {
    id: "fst-5",
    category: "first",
    template: "First step into {project}. Let's explore!",
    tags: ["first"],
  },
  {
    id: "fst-6",
    category: "first",
    template: "Started exploring {project}! 🗺️",
    tags: ["first"],
  },
  {
    id: "fst-7",
    category: "first",
    template: "{project} exploration: initiated.",
    tags: ["first"],
  },
  {
    id: "fst-8",
    category: "first",
    template: "Breaking ground in {project}!",
    tags: ["first"],
  },
  {
    id: "fst-9",
    category: "first",
    template: "Hello, {project}! First street complete.",
    tags: ["first"],
  },
  {
    id: "fst-10",
    category: "first",
    template: "New adventure: {project}. First street done!",
    tags: ["first"],
  },

  // --- COMPLETION / 100% (15) ---
  {
    id: "cmp-1",
    category: "completion",
    template: "100% of {project}! EVERY. SINGLE. STREET. 🏆",
    tags: ["completion"],
  },
  {
    id: "cmp-2",
    category: "completion",
    template: "{project}: COMPLETE. I ran them all.",
    tags: ["completion"],
  },
  {
    id: "cmp-3",
    category: "completion",
    template: "I know every street in {project} now. 🗺️",
    tags: ["completion"],
  },
  {
    id: "cmp-4",
    category: "completion",
    template: "{project} conquered! 100% complete.",
    tags: ["completion"],
  },
  {
    id: "cmp-5",
    category: "completion",
    template: "Mission accomplished: {project} 100%",
    tags: ["completion"],
  },
  {
    id: "cmp-6",
    category: "completion",
    template: "The {project} project is done. ALL streets.",
    tags: ["completion"],
  },
  {
    id: "cmp-7",
    category: "completion",
    template: "{project}: ✓✓✓ Fully explored!",
    tags: ["completion"],
  },
  {
    id: "cmp-8",
    category: "completion",
    template: "From 0 to 100% in {project}. Done!",
    tags: ["completion"],
  },
  {
    id: "cmp-9",
    category: "completion",
    template: "{project} mastered. Every corner explored.",
    tags: ["completion"],
  },
  {
    id: "cmp-10",
    category: "completion",
    template: "I am now a {project} local. 100% complete!",
    tags: ["completion"],
  },
  {
    id: "cmp-11",
    category: "completion",
    template: "{project}: No street left behind.",
    tags: ["completion"],
  },
  {
    id: "cmp-12",
    category: "completion",
    template: "Achievement: {project} completionist!",
    tags: ["completion"],
  },
  {
    id: "cmp-13",
    category: "completion",
    template: "The final street! {project} 100% ✓",
    tags: ["completion"],
  },
  {
    id: "cmp-14",
    category: "completion",
    template: "{project} exploration: FINISHED!",
    tags: ["completion"],
  },
  {
    id: "cmp-15",
    category: "completion",
    template: "Today I completed {project}. All {count} streets.",
    tags: ["completion"],
  },

  // --- IDENTITY / LOCAL (12) ---
  {
    id: "idn-1",
    category: "identity",
    template: "Becoming a {project} local, one street at a time.",
    tags: ["general"],
  },
  {
    id: "idn-2",
    category: "identity",
    template: "Getting to know {project} better every run.",
    tags: ["general"],
  },
  {
    id: "idn-3",
    category: "identity",
    template: "Street explorer status: {achievement}",
    tags: ["general"],
  },
  {
    id: "idn-4",
    category: "identity",
    template: "{achievement}. Building my map of {project}.",
    tags: ["general"],
  },
  {
    id: "idn-5",
    category: "identity",
    template: "Running my way through {project}. {achievement}",
    tags: ["general"],
  },
  {
    id: "idn-6",
    category: "identity",
    template: "{achievement}. One step closer to knowing every corner.",
    tags: ["general"],
  },
  {
    id: "idn-7",
    category: "identity",
    template: "Explorer mode: {achievement}",
    tags: ["general"],
  },
  {
    id: "idn-8",
    category: "identity",
    template: "{project} is becoming my territory. {achievement}",
    tags: ["general"],
  },
  {
    id: "idn-9",
    category: "identity",
    template: "Mapping {project} with my feet. {achievement}",
    tags: ["general"],
  },
  {
    id: "idn-10",
    category: "identity",
    template: "Street by street, I'm learning {project}.",
    tags: ["general"],
  },
  {
    id: "idn-11",
    category: "identity",
    template: "{achievement}. The {project} explorer journey continues.",
    tags: ["general"],
  },
  {
    id: "idn-12",
    category: "identity",
    template: "Another piece of {project} discovered. {achievement}",
    tags: ["general"],
  },

  // --- PLAYFUL (12) ---
  {
    id: "ply-1",
    category: "playful",
    template: "My legs hate me but my map loves me. {achievement}",
    tags: ["general"],
  },
  {
    id: "ply-2",
    category: "playful",
    template: "{achievement}. The streets were asking for it.",
    tags: ["general"],
  },
  {
    id: "ply-3",
    category: "playful",
    template: "Pac-Man mode: {achievement} 🟡",
    tags: ["general"],
  },
  {
    id: "ply-4",
    category: "playful",
    template: "{achievement}. I'm basically a human GPS now.",
    tags: ["general"],
  },
  {
    id: "ply-5",
    category: "playful",
    template: "Collecting streets like Pokemon. {achievement}",
    tags: ["general"],
  },
  {
    id: "ply-6",
    category: "playful",
    template: "{achievement}. My neighbors think I'm lost.",
    tags: ["general"],
  },
  {
    id: "ply-7",
    category: "playful",
    template: "Running places I didn't know existed. {achievement}",
    tags: ["general"],
  },
  {
    id: "ply-8",
    category: "playful",
    template: "{achievement}. The map is filling in nicely.",
    tags: ["general"],
  },
  {
    id: "ply-9",
    category: "playful",
    template: "Achievement unlocked! (not in a game, in real life)",
    tags: ["general"],
  },
  {
    id: "ply-10",
    category: "playful",
    template: "{achievement}. Take that, unexplored territory!",
    tags: ["general"],
  },
  {
    id: "ply-11",
    category: "playful",
    template: "Today's mission: {achievement}. Success!",
    tags: ["general"],
  },
  {
    id: "ply-12",
    category: "playful",
    template: "{achievement}. The streets fear me now.",
    tags: ["general"],
  },

  // --- WITH STATS (10) ---
  {
    id: "sta-1",
    category: "stats",
    template: "{achievement}! {percent}% of {project} done.",
    tags: ["general"],
  },
  {
    id: "sta-2",
    category: "stats",
    template: "{achievement}. {remaining} streets to go!",
    tags: ["general"],
  },
  {
    id: "sta-3",
    category: "stats",
    template: "{count} streets in {project}. {achievement}",
    tags: ["general"],
  },
  {
    id: "sta-4",
    category: "stats",
    template: "{achievement}. Progress: {percent}%",
    tags: ["general"],
  },
  {
    id: "sta-5",
    category: "stats",
    template: "Street count: {count}. {achievement}",
    tags: ["general"],
  },
  {
    id: "sta-6",
    category: "stats",
    template: "{achievement}. Only {remaining} left in {project}!",
    tags: ["general"],
  },
  {
    id: "sta-7",
    category: "stats",
    template: "{percent}% through {project}! {achievement}",
    tags: ["general"],
  },
  {
    id: "sta-8",
    category: "stats",
    template: "{achievement}. {count}/{total} streets explored.",
    tags: ["general"],
  },
  {
    id: "sta-9",
    category: "stats",
    template: "Milestone: {achievement} ({percent}%)",
    tags: ["general"],
  },
  {
    id: "sta-10",
    category: "stats",
    template: "{count} streets and counting. {achievement}",
    tags: ["general"],
  },

  // --- MOTIVATIONAL (10) ---
  {
    id: "mot-1",
    category: "motivational",
    template: "{achievement}! What's next?",
    tags: ["general"],
  },
  {
    id: "mot-2",
    category: "motivational",
    template: "{achievement}. The journey continues!",
    tags: ["general"],
  },
  {
    id: "mot-3",
    category: "motivational",
    template: "Progress, not perfection. {achievement}",
    tags: ["general"],
  },
  {
    id: "mot-4",
    category: "motivational",
    template: "{achievement}. Every run counts.",
    tags: ["general"],
  },
  {
    id: "mot-5",
    category: "motivational",
    template: "Small steps, big results. {achievement}",
    tags: ["general"],
  },
  {
    id: "mot-6",
    category: "motivational",
    template: "{achievement}. Momentum is building!",
    tags: ["general"],
  },
  {
    id: "mot-7",
    category: "motivational",
    template: "One milestone at a time. {achievement}",
    tags: ["general"],
  },
  {
    id: "mot-8",
    category: "motivational",
    template: "{achievement}. The grind doesn't stop.",
    tags: ["general"],
  },
  {
    id: "mot-9",
    category: "motivational",
    template: "Forward progress: {achievement}",
    tags: ["general"],
  },
  {
    id: "mot-10",
    category: "motivational",
    template: "{achievement}. Building something here.",
    tags: ["general"],
  },

  // --- PERCENTAGE MILESTONES (8) ---
  {
    id: "pct-1",
    category: "percentage",
    template: "Halfway there! 50% of {project} complete.",
    tags: ["percentage"],
  },
  {
    id: "pct-2",
    category: "percentage",
    template: "25% of {project} done. Getting started!",
    tags: ["percentage"],
  },
  {
    id: "pct-3",
    category: "percentage",
    template: "75% of {project}! Home stretch.",
    tags: ["percentage"],
  },
  {
    id: "pct-4",
    category: "percentage",
    template: "{percent}% of {project}. Progress!",
    tags: ["percentage"],
  },
  {
    id: "pct-5",
    category: "percentage",
    template: "{project}: {percent}% explored 🗺️",
    tags: ["percentage"],
  },
  {
    id: "pct-6",
    category: "percentage",
    template: "Quarter done! 25% of {project}.",
    tags: ["percentage"],
  },
  {
    id: "pct-7",
    category: "percentage",
    template: "The halfway point in {project}!",
    tags: ["percentage"],
  },
  {
    id: "pct-8",
    category: "percentage",
    template: "{percent}% and climbing in {project}.",
    tags: ["percentage"],
  },

  // --- VIRAL MARKETING (15) ---
  // Designed for shareability: curiosity gap, stats, challenges, social proof
  {
    id: "vir-1",
    category: "viral",
    template: "First street unlocked! 🔓 1/{totalNames} streets in {project}. How many streets have YOU run in your neighborhood? 🗺️ #StreetKeeper",
    tags: ["first", "curiosity", "challenge"],
  },
  {
    id: "vir-2",
    category: "viral",
    template: "Day 1 of running EVERY street in {project} — {remaining} to go! 🏃‍♂️ streetkeeper.app",
    tags: ["first", "challenge", "fomo"],
  },
  {
    id: "vir-3",
    category: "viral",
    template: "I'm mapping {project} one run at a time. Streets: {streetNames}/{totalNames} ✓ #StreetKeeper",
    tags: ["identity", "stats"],
  },
  {
    id: "vir-4",
    category: "viral",
    template: "Running every street in {city}. {streetNames} down, {remaining} to go! 🗺️ #StreetKeeper",
    tags: ["city", "challenge"],
  },
  {
    id: "vir-5",
    category: "viral",
    template: "Started exploring {project}! 🔓 1/{totalNames} streets. How many streets have YOU run? 🗺️ #StreetKeeper",
    tags: ["first", "curiosity"],
  },
  {
    id: "vir-6",
    category: "viral",
    template: "{streetNames}/{totalNames} streets {activityVerb} in {project}. The map is filling in! 🗺️ #StreetKeeper",
    tags: ["stats", "progress"],
  },
  {
    id: "vir-7",
    category: "viral",
    template: "Challenge accepted: running every single street in {project}. Progress: {streetNames}/{totalNames} 🏃‍♂️ #StreetKeeper",
    tags: ["challenge", "identity"],
  },
  {
    id: "vir-8",
    category: "viral",
    template: "My mission: explore every street in {city}. {streetNames} complete, {remaining} to go! 🗺️ #StreetKeeper",
    tags: ["city", "mission"],
  },
  {
    id: "vir-9",
    category: "viral",
    template: "First street in {project} complete! 🔓 {remaining} more to explore. Who else is mapping their neighborhood? 🗺️ #StreetKeeper",
    tags: ["first", "social"],
  },
  {
    id: "vir-10",
    category: "viral",
    template: "I {activityVerb} {streetNames} streets in {project} so far. Could YOU run every street in your area? 🗺️ #StreetKeeper",
    tags: ["challenge", "stats"],
  },
  {
    id: "vir-11",
    category: "viral",
    template: "{streetNames} streets down, {remaining} to go in {project}! Becoming a local legend, one run at a time 🏃‍♂️ #StreetKeeper",
    tags: ["identity", "progress"],
  },
  {
    id: "vir-12",
    category: "viral",
    template: "Exploring {project} street by street. {percent}% complete! How many streets have you run? 🗺️ #StreetKeeper",
    tags: ["progress", "curiosity"],
  },
  {
    id: "vir-13",
    category: "viral",
    template: "The {project} project: {streetNames}/{totalNames} streets {activityVerb}. No street left behind! 🗺️ #StreetKeeper",
    tags: ["mission", "stats"],
  },
  {
    id: "vir-14",
    category: "viral",
    template: "Started my street exploration journey in {project}! First street: ✓ | Remaining: {remaining} | Track yours → Street Keeper",
    tags: ["first", "cta"],
  },
  {
    id: "vir-15",
    category: "viral",
    template: "Running every street in {city}? Challenge accepted. {streetNames}/{totalNames} complete! 🏃‍♂️ #StreetKeeper",
    tags: ["city", "challenge", "stats"],
  },
];

// Total: 131 templates across 11 categories
// Easy to extend: just add more objects to the array
