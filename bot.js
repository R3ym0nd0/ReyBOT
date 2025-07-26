const mineflayer = require('mineflayer');
const collectBlock = require('mineflayer-collectblock').plugin;
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const autoEat = require('mineflayer-auto-eat').plugin;
const pvp = require('mineflayer-pvp').plugin;
const mcDataLoader = require('minecraft-data');

const { GoalNear } = goals;

const commandDescriptions = {
  '!help': 'Show this help message',
  '!follow': 'Follow the player who typed the command',
  '!stop': 'Stop all current actions (follow, chop, fight, mine, hunt)',
  '!chop': 'Chop nearby trees and deliver them',
  '!mine': 'Start mining ores and deliver them',
  '!fight': 'Fight the player who typed the command',
  '!hunt': 'Hunt nearby animals and bring back food'
};

const bot1 = mineflayer.createBot({
  host: 'localhost',
  port: 49918,
  username: 'ReyBOT',
});

botLogic(bot1);

function botLogic(bot) {
  const botState = {
    chopping: false,
    following: false,
    fighting: false,
    mining: false
  };

  let lastFollowedPlayer = null;
  
  bot.loadPlugin(pathfinder);
  bot.loadPlugin(collectBlock);
  bot.loadPlugin(autoEat);
  bot.loadPlugin(pvp);

  bot.once('spawn', () => {

    setTimeout(() => {
      autoEquipArmor()
    }, 1000)

    const sword = bot.inventory.items().find(item => item.name.includes('sword'));
    if (sword) {
      bot.equip(sword, 'hand').then(() => {
        bot.chat(`${sword.name} ready!! — where are the enemies at?`);
      });
    } 

    // 🛠️ Define it once and early!
    bot.autoEquipWeapon = () => {
      const sword = bot.inventory.items().find(item => item.name.includes('sword'));
      if (sword) bot.equip(sword, 'hand');
    };

    const mcData = mcDataLoader(bot.version);

    const defaultMove = new Movements(bot, mcData);
    defaultMove.scafoldingBlocks = ['dirt', 'cobblestone'];
    defaultMove.allow1by1towers = true;

    bot.pathfinder.setMovements(defaultMove);

    bot.chat("Type '!help' to see available commands!");
    setTimeout(() => {
      defaultFollow();
    }, 1000); // wait 1 second after spawn to follow the first visible player

    let warnedNoFood = false;
    bot.on('physicTick', () => {
      const hasFood = bot.inventory.items().some(item => {
        const food = bot.autoEat?.options?.bannedFood || [];
        return item && mcData.foodsByName?.[item.name] && !food.includes(item.name);
      });

      if (!hasFood && !warnedNoFood) {
        bot.chat("Hey, I don't have any food... mind giving me some?");
        warnedNoFood = true;
      }

      if (hasFood && warnedNoFood) {
        bot.chat("Nice! Thanks — I’ll do my best to back you up.");
        warnedNoFood = false;
      }
    });

    bot.autoEat.options = {
      enable: true,
      priority: 'foodPoints',
      startAt: 18,
      stopAt: 20,
      bannedFood: []
    };

    function defaultFollow() {
      const owner = Object.values(bot.players).find(p => p.username !== bot.username)?.entity;
      if (!owner) {
        bot.chat("Can't find anyone to follow when I spawned");
        return;
      }

      botState.following = true;
      lastFollowedPlayer = owner.username;

      const goal = new goals.GoalFollow(owner, 1);
      bot.pathfinder.setGoal(goal, true);
      bot.chat(`Yo ${owner.username}, I just spawned — I'm following you now haha.`);
    }

    bot.on('chat', async (username, message) => {
      if (username === bot.username) return;
      const msg = message.trim().toLowerCase(); 

      if (msg === '!chop') {

        const axeTypes = [
        'wooden_axe',
        'stone_axe',
        'iron_axe',
        'golden_axe',
        'diamond_axe',
        'netherite_axe'
        ];

        if (botState.chopping) return bot.chat("I'm already chopping tree!");
        botState.chopping = true;

        const player = bot.players[username]?.entity;
        lastFollowedPlayer = username;
        if (!player) return bot.chat("Where you at? I can't find you!");

        async function chopTreeLoop() {
          while (botState.chopping) {
            const logPositions = bot.findBlocks({
              matching: block => mcData.blocks[block.type].name.includes('log'),
              maxDistance: 16,
              count: 5,
            });

            if (!logPositions.length) {
              if (!botState.chopping) break;
              bot.chat('No trees around, lemme try again in 5 seconds.');
              await bot.waitForTicks(100);
              continue;
            }

            const targets = logPositions.map(pos => bot.blockAt(pos)).filter(Boolean);
            bot.chat(`I Found ${targets.length} logs. I’ll go grab 'em.`);

            try {
              const axe = bot.inventory.items().find(item => axeTypes.includes(item.name));
              if (axe) {
                await bot.equip(axe, 'hand');
                bot.chat(`Locked in with my ${axe.name}!!!`);
              } else {
                bot.chat("No axe, I guess I’m going bare hands!");
              }

              await bot.collectBlock.collect(targets);
              if (!botState.chopping) break;

              bot.chat('Done chopping, I\'m picking up the stuff now!');
              await bot.waitForTicks(20);

              const droppedLogs = Object.values(bot.entities).filter(entity =>
                entity.name === 'item' &&
                entity.metadata?.some(meta => meta?.itemId && mcData.items[meta.itemId]?.name?.includes('log'))
              );

              for (const item of droppedLogs) {
                if (!botState.chopping) break;
                try {
                  await bot.pathfinder.goto(new GoalNear(item.position.x, item.position.y, item.position.z, 1));
                } catch (err) {
                  bot.chat(`I can’t reach that item wtf... something’s blocking me.`);
                }
              }

              if (!botState.chopping) break;

              bot.chat('Got the logs, I\'m coming to you!');
              await bot.pathfinder.goto(new GoalNear(player.position.x, player.position.y, player.position.z, 1));

              const logsToGive = bot.inventory.items().filter(item => item.name.includes('log'));
              for (const item of logsToGive) {
                if (!botState.chopping) break;
                await bot.tossStack(item);
                await bot.waitForTicks(10);
              }
              bot.chat('Here you go, logs are all yours.');
              await bot.waitForTicks(40);

            } catch (err) {
              if (!botState.chopping) break;
              bot.chat(`Ugh, something went wrong... I’ll try again in 5 secs bro.`);
              await bot.waitForTicks(100);
            }
          }
          bot.chat("Gotcha, no more tree chopping.");
        }

        chopTreeLoop();
      }

      if (msg === '!follow') {
        const player = bot.players[username]?.entity;
        if (!player) return bot.chat("I can't see you!!!");

        botState.following = true;

        function followPlayer() {
          if (!player || !player.isValid) return;
          const goal = new goals.GoalFollow(player, 1);
          bot.pathfinder.setGoal(goal, true);
          bot.chat("Aight I’m with you, I’ll keep you safe.");
        }

        followPlayer();

        const followInterval = setInterval(() => {
          if (!botState.following || !player || !player.isValid) {
            bot.pathfinder.setGoal(null);
            clearInterval(followInterval);
            return;
          }

          const chest = player.equipment?.[3];
          const isFlying = player.elytraFlying || (chest && chest.name === 'elytra');

          if (isFlying) {
            if (botState.following) {
              botState.following = false;
              bot.chat("🪂 You're flying! Can't follow.");
              bot.pathfinder.setGoal(null);
            }
          } else {
            if (!botState.following) {
              botState.following = true;
              bot.chat("You're back! Following now.");
              followPlayer();
            }
          }
        }, 1000);
      }

      if (msg === '!fight') {
        const player = bot.players[username]?.entity;
        if (!player) return bot.chat("I can't see you!!!");
        botState.fighting = true;

        const sword = bot.inventory.items().find(i => i.name.includes('sword'));
        if (sword) await bot.equip(sword, 'hand');

        bot.pvp.attack(player);
        bot.chat("Say less, come on fight me!!");
      }

      if (msg === '!stop') {
        botState.chopping = false;
        botState.following = false;
        botState.fighting = false;
        botState.mining = false;
        botState.hunting = false;
        currentTarget = null;

        bot.pathfinder.setGoal(null);
        bot.pvp.stop();
        bot.chat("Aight, I'm chillin' now. No more actions.");
      }

      if (msg === '!mine') {
        bot.chat("Aight, time to mine now!!!");
        botState.mining = true;
        lastFollowedPlayer = username;
        mineLoop();
      }

      if (msg === '!hunt') {
        if (botState.hunting) return bot.chat("Already hunting!");
        botState.hunting = true;
        lastFollowedPlayer = username;

        bot.chat("I'll hunt for food!");

        async function huntLoop() {
          while (botState.hunting) {
            const target = bot.nearestEntity(entity =>
              ['cow', 'pig', 'chicken', 'sheep', 'rabbit'].includes(entity.name) &&
              entity.position.distanceTo(bot.entity.position) < 32
            );

            if (!target) {
              bot.chat("I'm not seing animals nearby... hold on.");
              await bot.waitForTicks(60);
              continue;
            }

            try {
              await bot.autoEquipWeapon?.();
              bot.chat(`Hunting ${target.name}!`);

              bot.pvp.attack(target);

              // Wait until the target is gone (i.e. dead)
              await new Promise((resolve, reject) => {
                const checkIfDead = setInterval(() => {
                  if (!botState.hunting) {
                    clearInterval(checkIfDead);
                    return resolve(); // stop hunting externally
                  }

                  const stillThere = bot.entities[target.id];
                  if (!stillThere) {
                    clearInterval(checkIfDead);
                    return resolve(); // mob is dead
                  }
                }, 500); // check every 0.5 second
              });

              // Collect nearby drops
              const drops = Object.values(bot.entities).filter(e =>
                e.name === 'item' &&
                e.position.distanceTo(bot.entity.position) < 8
              );

              for (const item of drops) {
                await bot.pathfinder.goto(new GoalNear(item.position.x, item.position.y, item.position.z, 1));
              }

              const player = bot.players[lastFollowedPlayer]?.entity;
              if (player) {
                bot.chat("I got the meat! Let me deliver it to you now.");
                await bot.pathfinder.goto(new GoalNear(player.position.x, player.position.y, player.position.z, 1));

                const foodItems = bot.inventory.items().filter(i =>
                  ['beef', 'chicken', 'porkchop', 'mutton', 'rabbit'].includes(i.name)
                );

                for (const item of foodItems) {
                  await bot.tossStack(item);
                  await bot.waitForTicks(10);
                }

                bot.chat("Here’s your food!!");
              }

            } catch (err) {
              bot.chat(`Couldn't hunt: ${err.message}`);
            }

            await bot.waitForTicks(20);
          }

          bot.chat("Aight I Stopped hunting.");
        }

        huntLoop();
      }
      
      if (msg === '!help') {
        bot.chat("COMMANDS I UNDERSTAND:");
        for (const [cmd, desc] of Object.entries(commandDescriptions)) {
          bot.chat(`${cmd} — ${desc}`);
        }
      }
  });

    // Autoeat debug logs
    bot.on('autoeat_started', item => bot.chat(`Hold up, lemme eat this ${item.name} real quick...`));
    bot.on('autoeat_finished', item => bot.chat(`Done eating ${item.name}`));
    bot.on('autoeat_error', err => bot.chat(`Bruh, I can't eat... ${err.message}`));

    bot.on('death', () => {
      currentTarget = null;
      bot.chat("I died wtf?? hold on I'll respawn...");
    });

    bot.on('end', () => {
      console.log("I disconnect. Hold on(5s)...");
      setTimeout(() => {
        require('child_process').spawn('node', ['bot.js'], {
          cwd: __dirname,
          stdio: 'inherit',
          shell: true
        });
      }, 5000);
    });

    bot.on('playerCollect', async (collector) => {
      if (collector !== bot.entity) return // Only react if bot is the one collecting

      setTimeout(() => {
        autoEquipArmor()
      }, 500) // Delay ensures item reaches inventory
    })

    async function autoEquipArmor() {
      const armorSlots = {
        head: ['helmet'],
        torso: ['chestplate'],
        legs: ['leggings'],
        feet: ['boots']
      }

      for (const item of bot.inventory.items()) {
        const name = item.name.toLowerCase()

        // Skip cursed armor
        if (item.nbt) {
          const enchants = item.nbt?.value?.Enchantments?.value?.value || []
          const isCursed = enchants.some(e =>
            e.id.value.includes('vanishing') || e.id.value.includes('binding')
          )
          if (isCursed) continue
        }

        for (const [slot, keywords] of Object.entries(armorSlots)) {
          if (keywords.some(k => name.includes(k))) {
            const equipped = bot.inventory.slots[bot.getEquipmentDestSlot(slot)]
            if (!equipped) {
              try {
                await bot.equip(item, slot)
                bot.chat(`Aight, I got the ${item.name} on!`)
              } catch (err) {
                bot.chat(`I couldn't equip ${item.name}... something's off`)
              }
            }
          }
        }
      }
    }

    async function mineLoop() {
      const ores = [
        'coal_ore', 'iron_ore', 'copper_ore', 'gold_ore', 'diamond_ore',
        'lapis_ore', 'redstone_ore',
        'deepslate_iron_ore', 'deepslate_gold_ore', 'deepslate_diamond_ore',
        'deepslate_redstone_ore', 'deepslate_coal_ore'
      ];

      let minedCount = 0;
      let lastMinedPos = null;

      while (botState.mining) {
        const targets = bot.findBlocks({
          matching: block => ores.includes(block.name),
          maxDistance: 32,
          count: 1
        });

        if (!botState.mining) break;

        if (targets.length === 0) {
          bot.chat("Bruh, where the ores at?");
          await bot.waitForTicks(60);
          continue;
        }

        const targetPos = targets[0];
        const block = bot.blockAt(targetPos);

        if (!botState.mining || !block) {
          await bot.waitForTicks(20);
          continue;
        }

        lastMinedPos = block.position.clone();

        try {
          const pickaxe = bot.inventory.items().find(item => item.name.includes('pickaxe'));
          if (pickaxe) {
            await bot.equip(pickaxe, 'hand');
            bot.chat(`Locked in with my ${pickaxe.name}!!!`);
          } else {
            bot.chat("I don't have a pickaxe... guess I'll just use my hands.");
          }

          await bot.pathfinder.goto(new goals.GoalBlock(block.position.x, block.position.y, block.position.z));
          await bot.dig(block);
          bot.chat(`I mine ${block.name}!`);
          minedCount++;

        } catch (err) {
          bot.chat(`Something’s off with this ${block.name}... skipping for now.`);
          if (err.message.includes("took too long")) {
            bot.chat("Hmm, I couldn’t reach it. Let me try again...");
            await bot.waitForTicks(20);
            continue;
          } else {
            bot.chat("Weird... something went wrong. I'm Skipping that one.");
            await bot.waitForTicks(20);
            continue;
          }
        }

        await bot.waitForTicks(20);

        // 🛍️ Deliver every 5 ores
        if (minedCount >= 5) {
          const player = bot.players[lastFollowedPlayer]?.entity;
          if (player) {
            bot.chat('Got the ores, I\'m coming to you!');
            try {
              await bot.pathfinder.goto(new GoalNear(player.position.x, player.position.y, player.position.z, 1));

              const oreItems = bot.inventory.items().filter(item =>
                item.name.includes('ore') || ['coal', 'raw_iron', 'raw_gold', 'raw_copper', 'diamond', 'lapis_lazuli', 'redstone'].includes(item.name)
              );

              for (const item of oreItems) {
                if (!botState.mining) break;
                await bot.tossStack(item);
                await bot.waitForTicks(10);
              }

              bot.chat('Here you go, ores are all yours.');
              minedCount = 0;

              if (lastMinedPos && botState.mining) {
                await bot.pathfinder.goto(new goals.GoalBlock(lastMinedPos.x, lastMinedPos.y, lastMinedPos.z));
                bot.chat("I'll go back to mining area!");
              }

            } catch (err) {
              bot.chat(`Uhh... something went wrong while delivering.`);
            }
          } else {
            bot.chat("I Can't find you to deliver ores");
          }
        }
      }

      bot.chat("Aight, I'm done mining for now.");
    }

    bot.on('time', () => {
      const time = bot.time.timeOfDay;

      // Minecraft time range for night (e.g., 13000–23000)
      if (time > 13000 && time < 23000) {
        const bed = bot.findBlock({
          matching: block => bot.isABed(block),
          maxDistance: 6
        });

        if (bed && !bot.isSleeping) {
          bot.chat('It\'s time to sleep...');
          bot.sleep(bed).then(() => {
            bot.chat('I\'m sleeping now...');
          }).catch(err => {
            bot.chat('Could not sleep: ' + err.message);
          });
        }
      }
    });

    bot.on('wake', () => {
      bot.chat('🌞 Good morning!');
    });

    let justFought = false;
    bot.on('stoppedAttacking', () => {
      if (justFought) return;
      justFought = true;
      setTimeout(() => justFought = false, 3000); // 3s cooldown

      if (botState.following && lastFollowedPlayer) {
        const player = bot.players[lastFollowedPlayer]?.entity;
        if (player && player.isValid) {
          const goal = new goals.GoalFollow(player, 1);
          bot.pathfinder.setGoal(goal, true);
          bot.chat(`Done fighting. I'm coming back to you`);
        }
      }
    });

    let isAttacking = false;
    setInterval(() => {
      if (isAttacking) return;

      const allEntities = Object.values(bot.entities);
      const nearbyMobs = allEntities
        .filter(e =>
          (e.type === 'hostile' || e.type === 'mob') &&
          bot.entity.position.distanceTo(e.position) < 10
        )
        .sort((a, b) =>
          bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position)
        );

      if (nearbyMobs.length > 0) {
        const target = nearbyMobs[0];
        isAttacking = true;
        bot.chat(`I'm Attacking ${target.displayName}!!!`);
        bot.autoEquipWeapon?.();
        bot.pvp.attack(target);

        setTimeout(() => {
          isAttacking = false;
        }, 1000); // allow new attack after 1 sec
      }
    }, 500);
  });   
}