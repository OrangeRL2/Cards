HELLO! A BRAND NEW SUMMER — COMPLETE ACTIVITY + FUSION PACKAGE

Copy the folders into the bot root, replacing the previous Summer files.

Then run:
  node -c Commands/Event/summer.js
  node -c Commands/Admin/summer-admin.js
  node -c models/SummerUser.js
  node -c utils/summerActivity.js
  node -c utils/summerFusion.js
  node -c utils/sunPull.js
  node scripts/patch-summer-full-art-inventory.js
  node deploy-commands.js

Restart the bot.

TESTING THE FIRST THREE DAYS
  /summer-admin test-day user:@You day:1 unlock-all:true
  /summer-admin grant-pulls user:@You amount:10
  /summer

Use reset-activities before replaying the same day:
  /summer-admin reset-activities user:@You

Implemented:
- Three core activity choices in each Morning/Noon/Evening window.
- Choosing one locks it and removes the other two.
- Three VN choice steps per selected activity.
- Each option has its own result dialogue.
- Eligible SUN member pool is accumulated from selected options.
- One shared weighted reward roll after completion.
- Shells, SUN Pulls, and eligible standard SUN cards.
- One completion per time window.
- First three August days filled with test scenes; days 4–31 remain editable.
- Seventeen Full Art recipes and fusion menu.
- Fusion consumes one of every required standard SUN card.
- Full Art inventory cards are stored as "Full Art: <route>" with rarity SUN.

EDITING:
  config/summer-activities.json — all dialogue, buttons, choices, and eligibleSunMembers.
  config/summer-rewards.js — reward odds.
  config/summer-full-art-recipes.js — fusion recipes.

Current default activity reward weights:
  40% 10 shells
  28% 20 shells
  15% 40 shells
  10% 1 SUN Pull
   7% eligible standard SUN card
