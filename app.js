const mineflayer = require('mineflayer')
const config = require('./config.json')
require('dotenv').config();//read the env

console.log("Starting bot")
//check config
if (!process.env.BOT_OWNER) throw new Error("Owner not specified!")

//maybe search for port if not supplied and 25565 wont work
//remember to finish the building blocks category
//problem with bot thinking it took items, when it actually didn't
//making it async seems to make no difference


const bot = mineflayer.createBot({
    host: process.env.TARGET_HOST ? process.env.TARGET_HOST : "localhost",
    port: process.env.TARGET_PORT ? process.env.TARGET_PORT : 25565,
    username: process.env.BOT_USERNAME ? process.env.BOT_USERNAME : "sorter_bot",
    //password: process.env.PASSWORD,//only uncomment if using a real server, which is not recommended
    version: false     // false corresponds to auto version detection (that's the default), put for example "1.8.8" if you need a specific version
})

const { pathfinder, Movements } = require('mineflayer-pathfinder')
const { GoalNear, GoalBlock, GoalXZ, GoalY, GoalInvert, GoalFollow } = require('mineflayer-pathfinder').goals;
const { Block } = require('prismarine-block');
const { Vec3 } = require('vec3');
const Chest = require('mineflayer/lib/chest');
const { Item } = require('prismarine-item');

var defaultMove;
var mcData;

/** @type {null|"settingUp"|"sorting"|"moving"} */
var currentActivity = null;
/** @type {Destination[]} */
//Cycles through the chests in order, and shifts them to the back once interacted with
var allDestinations = []
/** @type {mineflayer.Chest} */
var currentChestBlock;

//load and configure plugins
bot.loadPlugin(pathfinder)
const inventoryViewer = require('mineflayer-web-inventory')
let options = {
    port: 8080
}

//#region Events
bot.on('kicked', (reason, loggedIn) => console.log(reason, loggedIn))
bot.on('error', err => console.log(err))

bot.once('spawn', () => {
    // Once we've spawn, it is safe to access mcData because we know the version
    const mcData = require('minecraft-data')(bot.version)
    const mcItem = require('prismarine-item')(bot.version)
    inventoryViewer(bot, options)

    // We create different movement generators for different type of activity
    const defaultMove = new Movements(bot, mcData)
    //restrict movement because it's designed for safe, controlled environments
    defaultMove.canDig = false;
    defaultMove.allow1by1towers = false;
    defaultMove.allowParkour = false;
    defaultMove.allowFreeMotion = false;

    bot.on('goal_reached', (goal) => {
        console.log('Goal reached')
        if (currentActivity == "sorting" && allDestinations.length > 0) {
            let chest = allDestinations[0]
            let block = bot.blockAt(chest.Vec3)
            bot.lookAt(chest.Vec3).then(() => {
                currentChestBlock = bot.openChest(block)//open it
            })
        }
    })

    bot.on('chat', (username, message) => {
        if (username != process.env.BOT_OWNER) return//ignore anybody not on the list

        const target = bot.players[username] ? bot.players[username].entity : null
        if (message === 'come') {
            if (!target) {
                bot.chat('I don\'t see you !')
                return
            }
            const p = target.position

            bot.pathfinder.setMovements(defaultMove)
            bot.pathfinder.setGoal(new GoalNear(p.x, p.y, p.z, 1))
        } else if (message.startsWith('goto')) {
            const cmd = message.split(' ')

            if (cmd.length === 4) { // goto x y z
                const x = parseInt(cmd[1], 10)
                const y = parseInt(cmd[2], 10)
                const z = parseInt(cmd[3], 10)

                bot.pathfinder.setMovements(defaultMove)
                bot.pathfinder.setGoal(new GoalBlock(x, y, z))
            } else if (cmd.length === 3) { // goto x z
                const x = parseInt(cmd[1], 10)
                const z = parseInt(cmd[2], 10)

                bot.pathfinder.setMovements(defaultMove)
                bot.pathfinder.setGoal(new GoalXZ(x, z))
            } else if (cmd.length === 2) { // goto y
                const y = parseInt(cmd[1], 10)

                bot.pathfinder.setMovements(defaultMove)
                bot.pathfinder.setGoal(new GoalY(y))
            }
        } else if (message === 'follow') {
            bot.pathfinder.setMovements(defaultMove)
            bot.pathfinder.setGoal(new GoalFollow(target, 3), true)
            // follow is a dynamic goal: setGoal(goal, dynamic=true)
            // when reached, the goal will stay active and will not
            // emit an event
        } else if (message === 'avoid') {
            bot.pathfinder.setMovements(defaultMove)
            bot.pathfinder.setGoal(new GoalInvert(new GoalFollow(target, 5)), true)
        } else if (message === 'stop') {
            bot.pathfinder.setGoal(null)
            currentActivity = null;
        } else if (message === 'sort') {
            //register chests
            setupChests(bot)
        } else if (message === "sayitems") {
            let output = bot.inventory.items().map((i) => i.name).join(', ')
            if (output) {
                bot.chat(output)
            } else {
                bot.chat('empty')
            }

        }
    })

    bot.on('windowOpen', (window) => {
        if (window.type == "minecraft:chest" && currentActivity == "sorting") {
            //during normal operation
            var currentChest = allDestinations[0]
            var chestInv = window.itemsRange(0, window.inventoryStart - 1)
            var botInv = window.itemsRange(window.inventoryStart, window.inventoryEnd)

            //check items in chest first
            setTimeout(() => {
                if (!currentChestBlock.window) {
                    console.log("Chest window failed to load in time!")
                    return;
                }
                chestInv.forEach(async item => {
                    if (item) {
                        //if not allowed to be there
                        if (!currentChest.allowedItems.includes(item.name)) {
                            //and free space in inventory
                            if (bot.inventory.emptySlotCount() > 0) {
                                //try {
                                //take it out
                                await currentChestBlock.withdraw(item.type, item.metadata, item.count)
                                //} catch (err) {
                                //    console.log(`Failed to move ${item.name} to inventory: ${err}`)
                                //}
                            } else {
                                console.log(`Tried to take an item, but my inventory is full`)
                            }
                        }
                    }
                })
            }, 1000);

            //now put stuff there if it can
            setTimeout(() => {
                if (!currentChestBlock.window) {
                    console.log("Chest window failed to load in time!")
                    return;
                }
                botInv.forEach(async item => {
                    if (item) {
                        let emptyChestSlot = window.firstEmptyInventorySlot()
                        //if it should be in the chest
                        if (currentChest.allowedItems.includes(item.name)) {
                            //and free space in the chest
                            if (emptyChestSlot) {
                                //try {
                                //put it in
                                await currentChestBlock.deposit(item.type, item.metadata, item.count)
                                //} catch (err) {
                                //    console.log(`Failed to move ${item.name} to chest slot ${emptyChestSlot}: ${err}`)
                                //}
                            } else {
                                console.log("This chest is full")
                            }
                        }
                    }
                })
            }, 1500);

            setTimeout(() => {
                //moves it to the back of the queue
                allDestinations.push(allDestinations.shift())
                bot.closeWindow(window)
                //set the next target
                let nextVec3 = allDestinations[0].Vec3
                bot.pathfinder.setGoal(new GoalNear(nextVec3.x, nextVec3.y, nextVec3.z, 2))
            }, 5000);
        }
    })
})
//#endregion

//#region Classes
/**
 * Attaches a useful category label to chests for the bot
 */
class Destination {
    /**
     * @param {"potions"|"brewing"|"weapons"|"food"|"farming"|"transport"|"tools"|"armor"|"glass"|"wool"|"redstone"|"concrete"|"banner"|"building_blocks"|"ore"|"dye"|"clay"|"materials"|"music"|"misc"} 
     *type The category seen by the bot - REQUIRED
     */
    constructor(type, x, y, z) {
        this.type = type
        //just leave blank if not found
        this.allowedItems = config.categories.find(cat => cat.name == type) ? config.categories.find(cat => cat.name == type).items : []
        this.x = x
        this.y = y
        this.z = z
        //for convenience
        this.Vec3 = new Vec3(x, y, z)
    }
}
//#endregion

//#region Functions

/**
 * Scans and returns any chests it finds, or null if it can't find any
 * @param {mineflayer.Bot} bot The bot that will setup its chests
 * @returns {Destination[]|null} The results of the search. Can be null
 */
function setupChests(bot) {
    allDestinations = [];//empty the list first
    //don't forget to catch specialty chests too, e.g. "Gold" would override the classifier and cause the bot to prioritize putting gold in there if it can
    bot.findBlocks({ matching: 54, count: 10 }).forEach(block => {//searches for chests
        let signText = testAround(block.x, block.y, block.z)
        if (signText) {
            var text = signText.trim().toLowerCase()
            var entry = config.categories.find(category =>
                category.aliases.includes(text)
            )
            if (entry) {
                allDestinations.push(new Destination(entry.name, block.x, block.y, block.z))
                bot.chat(`Registered ${block} as ${entry.name}`)
                console.log(`Registered ${block} as ${entry.name}`)
            } else {
                bot.chat(`Just a heads up, I'm not sure how to categorize "${text}," so I'll ignore it`)
                console.log(`I wasn't sure how to categorize ${text}`)
            }
        }
    })
    if (allDestinations.length > 0) {
        let o = allDestinations[0].Vec3
        bot.pathfinder.setGoal(new GoalNear(o.x, o.y, o.z, 2))
        currentActivity = "sorting"
    } else {
        bot.chat("There aren't any chests with signs on them nearby!")
        bot.chat("Please lead me to your chest room before using this command.")
    }
}



/**
 * Searches for a sign around the block, and returns the text if found
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {string|null}
 */
function testAround(x, y, z) {
    let testPos = new Vec3(x, y, z)
    testPos.x++;
    if (bot.blockAt(testPos).type == 68) {//pos x
        return bot.blockAt(testPos).signText
    }
    testPos.x -= 2;
    if (bot.blockAt(testPos).type == 68) {//negative x
        return bot.blockAt(testPos).signText
    }
    testPos.x++;//reset x
    testPos.z++;
    if (bot.blockAt(testPos).type == 68) {//pos z
        return bot.blockAt(testPos).signText
    }
    testPos.z -= 2;
    if (bot.blockAt(testPos).type == 68) {//negative z
        return bot.blockAt(testPos).signText
    }
    return null;
}

//#endregion