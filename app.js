const mineflayer = require('mineflayer')
const pf = require('mineflayer-pathfinder')
const config = require('./config.json')
require('dotenv').config();//read the env

//check config
if (!process.env.BOT_OWNER) throw new Error("Owner not specified!")

//maybe search for port if not supplied and 25565 wont work

//ERROR timeouts are being caused by the pathfinder. Cant figure out why
//may have to do with all the chest instances Im creating


//remember to finish the building blocks category



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

var defaultMove;
var mcData;

/** @type {null|"sorting"|"moving"} */
var currentActivity = null;
/** @type {SortingChest[]} */
var sortChests = []
//Cycles through the chests in order, and shifts them to the back once interacted with

bot.loadPlugin(pathfinder)

bot.on('kicked', (reason, loggedIn) => console.log(reason, loggedIn))
bot.on('error', err => console.log(err))

bot.once('spawn', () => {
    // Once we've spawn, it is safe to access mcData because we know the version
    const mcData = require('minecraft-data')(bot.version)

    // We create different movement generators for different type of activity
    const defaultMove = new Movements(bot, mcData)

    bot.on('path_update', (r) => {
        const nodesPerTick = (r.visitedNodes * 50 / r.time).toFixed(2)
        console.log(`I can get there in ${r.path.length} moves. Computation took ${r.time.toFixed(2)} ms (${nodesPerTick} nodes/tick).`)
    })

    bot.on('goal_reached', (goal) => {
        console.log('Goal reached')
        if (currentActivity == "sorting") {
            let block = bot.blockAt(sortChests[0].Vec3)
            console.log(`Opening ${block}`)
            bot.lookAt(sortChests[0].Vec3).then(() => {
                bot.openChest(block)
                sortChests[0].emit("open")
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
            currentActivity = "sorting";
            //starts the loop
            let tempBlock = sortChests[0]
            console.log("Going to " + tempBlock.Vec3)
            bot.pathfinder.setGoal(new GoalNear(tempBlock.x, tempBlock.y, tempBlock.z, 2))
        }
    })
})
//#region Classes

/**
 * Attaches a useful category label to chests for the bot
 */
class SortingChest extends mineflayer.Chest {
    /**
     * @param {"potions"|"brewing"|"weapons"|"food"|"farming"|"transport"|"tools"|"armor"|"glass"|"wool"|"redstone"|"concrete"|"banner"|"building_blocks"|"ore"|"dye"|"clay"|"materials"|"music"|"misc"} 
     *type The category seen by the bot - REQUIRED
     */
    constructor(type, x, y, z) {
        super();
        this.type = type
        this.allowedItems = config.categories.find(cat => cat.name == type).items
        this.x = x
        this.y = y
        this.z = z
        this.Vec3 = new Vec3(x, y, z)
    }
}


//#endregion
//#region Functions

/**
 * Scans and returns any chests it finds, or null if it can't find any
 * @param {mineflayer.Bot} bot The bot that will setup its chests
 * @returns {SortingChest[]|null} The results of the search. Can be null
 */
function setupChests(bot) {
    sortChests = [];//empty the list first
    //dont forget to catch specialty chests too, e.g. "Gold" would override the classifier and cause the bot to prioritize putting gold in there if it can
    bot.findBlocks({ matching: 54, count: 10 }).forEach(block => {//searches for chests
        console.log("Testing " + block);
        let signText = testAround(block.x, block.y, block.z)
        if (signText) {
            var entry = config.categories.find(category =>
                category.aliases.includes(signText.trim().toLowerCase())
            )
            if (entry) {
                sortChests.push(new SortingChest(entry.name, block.x, block.y, block.z))
                console.log(`Registered ${block} as ${entry.name}`)
            }
        }
    })
    sortChests.forEach(chest => {
        chest.removeAllListeners()//destroy listeners before adding new ones
        chest.on('open', () => {//open the chest
            console.log("Opened a chest")
            chest.items().forEach(item => {//first check the items already in there
                console.log(item)
                if (chest.allowedItems.includes(item.name)) {//if its allowed to be there
                    //ignore for now
                } else {//if its not allowed to be there
                    //only take if inv has space
                    if (bot.inventory.emptySlotCount >= 1) {
                        chest.withdraw(item.type, item.count).catch(() => {
                            console.log(`Failed to withdraw ${item.type}, my inventory is probably full`)
                        })
                    }
                }
            })
            //now see if anything from inv should go there
            bot.inventory.items().forEach(item => {
                if (chest.allowedItems.includes(item.name)) {
                    chest.deposit(item.type, item.count).catch(() => {
                        console.log(`Failed to deposit ${item.type}, the chest is probably full`)
                    })
                }
            })
            //done with this chest, its ok to close it now
            chest.close()
            sortChests[0].emit("close")
        })

        //close listener
        chest.on('close', () => {
            //move it to the back of the queue
            sortChests.push(sortChests.shift())
            //now tell the pathfinder to go to the next chest
            let nextBlock = sortChests[0]
            console.log("Going to " + nextBlock)
            bot.pathfinder.setGoal(new GoalNear(nextBlock.x, nextBlock.y, nextBlock.z, 2))
        })
    })
    console.log(sortChests)
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