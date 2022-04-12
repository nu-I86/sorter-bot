# sorter-bot
A simple Minecraft bot designed to organize chests based on item categories, powered by [mineflayer](https://github.com/PrismarineJS/mineflayer). A custom terminal is used for inputting commands.

## Commands
I'll revisit this when its ready to use

## Variables
Aren't sure how to use env varables? [This page](https://codeburst.io/process-env-what-it-is-and-why-when-how-to-use-it-effectively-505d0b2831e7) might help.

## How it works
1) Each chest is tested for a sign used to label it
2) The text on the sign is used to determine it's category
3) The bot cycles through the chests and tests each item in both inventories. If the item name is in the category of the chest, it stays there, otherwise it gets removed.

There is one special category designed for ease of logistics called `deposit`. This chest is **withdraw only** and designed to give players a dump area, and **integrate with other systems** such as a super smelter.
It's also possible to fully automate cooking and smelting using the `ore` and `cookable` catagories.
