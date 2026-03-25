Reign: Realities of the One-Roll Engine (Foundry VTT)
A comprehensive, automated system for playing Reign (2nd Edition) in Foundry VTT. This system focuses on the unique "One-Roll" mechanics, allowing players and GMs to handle everything from individual combat to the grand strategy of Factions with a single throw of the dice.

⚔️ Core Combat Features

Integrated ORE Roller: Handles Base Pools, Expert Dice (ED), Master Dice (MD), and Called Shots with a clean, interactive dialog. 


Dynamic Health Tracking: Automated hit location tracking for Head, Torso, Arms, and Legs. 


Wound Automation: Automatically calculates and applies dice pool penalties for Wounds and the Dazed (−1d) status from Torso shock. 


Shield Mechanics: Full support for Shield Cover AR and automated Parry Bonuses (+d) when a shield is equipped. 


Advanced Sorcery: Includes dedicated Counterspell anchors with automated "Gobble Dice" logic to protect casters from incoming spells. 

🚩 Faction & Company Mechanics
Action Catalog: A pre-loaded list of standard Company Actions (Attack, Tax, Espionage, etc.) that auto-fills dice pools and difficulty thresholds.

Automatic Action Costs: Executing Company Actions automatically deducts the required 1 Temporary Quality (e.g., Treasure or Influence) and logs it to chat.

Assets & Liabilities: Manage your organization's mechanical hooks using the integrated Asset (Advantage) and Liability (Problem) lists.

💀 Unworthy Opponents (Threats)
Magnitude Attrition: Automated "Battlefield Attrition" logic that converts incoming damage directly into Magnitude loss.

Automated Morale: Threats automatically roll a Morale Check whenever they lose Magnitude.

Rout Logic: System automatically triggers a "Rout" status if a Threat's Morale or Magnitude hits zero.

🛠️ Implementation Details

Audit Compliant: Fully updated to resolve Phase 1 & 2 of the v3 Audit, ensuring secure, centralized math parsing and correct RAW (Rules as Written) recovery rounding. 


Flexible ORE Engine: Centralized helper scripts for parsing ORE sets, handling "Width" damage formulas, and managing effective max health. 

📜 Credits & License
System Developer: LeonK

Original Game Design: Greg Stolze


Engine: One-Roll Engine (ORE)