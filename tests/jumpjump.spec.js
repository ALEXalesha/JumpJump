// Законы «Прыг-скока» после доработки для «Игротеки»: 8 уровней в двух мирах проходимы
// (поиск пути по правилам прыжка с пружинами и движущимися платформами), флаг ведёт дальше,
// боссы побеждаются прыжками и открывают следующий мир, звёзды и рекорды, контрольные
// флажки, жизни по сложности, платформы, пружины, шипы, экран победы, прогресс, пауза.
const { test, expect } = require('@playwright/test');
const { openGame, fitReport, expectFits, SIZES } = require('./_games-helpers');
const { hideTab, showTab, blurWindow, focusWindow, pauseLayout } = require('./_kit-helpers');

// Поиск пути по клеткам: где можно стоять и куда можно допрыгнуть (высота и дальность прыжка
// считаются из GRAV, JUMP_V, SPRING_V и WALK игры). Промежуточные столбцы не должны закрывать дугу прыжка.
const REACH = `(i) => {
  const g = __game; g.loadLevel(i); const L = g.level, T = g.T, TILE = g.TILE;
  const solid = (x, y) => g.tileAt(x, y) !== T.EMPTY;
  const key = (x, y) => x + ',' + y;
  const spikeAt = (x, y) => L.spikes.some((s) => y === Math.floor(s.y / TILE) && x * TILE + 16 > s.x && x * TILE + 16 < s.x + s.w);
  const stand = new Map();
  for (let x = 0; x < L.w; x++) for (let y = 1; y < 11; y++) if (!solid(x, y) && solid(x, y + 1) && !spikeAt(x, y)) stand.set(key(x, y), [x, y]);
  for (const m of L.movers) {
    const x0 = Math.floor(m.bx / TILE), y0 = Math.floor(m.by / TILE) - 1, n = Math.round(m.w / TILE), r = Math.round(m.range / TILE);
    for (let d = 0; d <= r; d++) for (let k = 0; k < n; k++) m.axis === 'x' ? stand.set(key(x0 + k + d, y0), [x0 + k + d, y0]) : stand.set(key(x0 + k, y0 - d), [x0 + k, y0 - d]);
  }
  const springs = new Set(L.springs.map((s) => key(Math.floor((s.x + 12) / TILE), Math.floor(s.y / TILE))));
  // Прыжок по законам игры: высота v²/2g, время до приземления на высоте rise, вбок - шагом (без бега, с запасом).
  // Путь по клеткам: 32*dx - 52 (ширина героя 22 свисает с краёв) должен уложиться в полёт.
  const can = (dx, rise, v) => {
    const Hp = v * v / (2 * g.GRAV), need = rise * TILE;
    if (need > Hp - 6) return false;
    const t = (v + Math.sqrt(v * v - 2 * g.GRAV * need)) / g.GRAV;
    return dx === 0 || TILE * dx - 52 <= g.WALK * t;
  };
  const clear = (x, x2, top, bottom) => { for (let c = Math.min(x, x2) + 1; c < Math.max(x, x2); c++) for (let r = Math.max(0, top); r <= bottom; r++) if (solid(c, r)) return false; return true; };
  const start = key(2, 9), seen = new Set([start]), queue = [[2, 9]];
  while (queue.length) {
    const [x, y] = queue.shift();
    const v = springs.has(key(x, y)) ? -g.SPRING_V : -g.JUMP_V, up = Math.floor(v * v / (2 * g.GRAV) / TILE);
    for (const [k, [x2, y2]] of stand) {
      if (seen.has(k) || Math.abs(x2 - x) > 8) continue;
      if (!can(Math.abs(x2 - x), y - y2, v)) continue;
      if (!clear(x, x2, y - up, Math.min(y, y2))) continue;
      seen.add(k); queue.push([x2, y2]);
    }
  }
  const goalX = L.boss ? Math.floor(L.arena.a / TILE) + 3 : Math.floor(L.flagHit / TILE);
  let best = 0; for (const k of seen) best = Math.max(best, Number(k.split(',')[0]));
  return { reached: best >= goalX - 1, best, goalX, cells: seen.size };
}`;

// Пробежать до флага, прыгая через всё: телепорт по контрольным флажкам, потом к флагу
const FINISH = `() => {
  const g = __game, L = g.level;
  for (const c of L.checkpoints) { g.player.x = c.x + 4; g.player.y = 9 * 32 - 30; g.step(2, false); }
  g.clearEnemies();
  g.player.x = L.flagHit - 40; g.player.y = 9 * 32 - 30; g.player.vy = 0; g.player.invuln = 999;
  g.kit.held.add('ArrowRight'); for (let i = 0; i < 60 && g.state.phase === 'play'; i++) g.step(1, false); g.kit.held.delete('ArrowRight');
  const ph = g.state.phase; g.step(110, false);
  return ph;
}`;

// Прыжки на босса сверху, пока не падёт (у голема - только когда отдыхает)
const BEAT_BOSS = `() => {
  const g = __game, L = g.level;
  g.player.x = L.arena.a + 80; g.player.y = 9 * 32 - 30; g.step(2, false);
  let n = 0;
  while (g.boss && n++ < 6000) {
    const b = g.boss;
    const ready = b.inv === 0 && b.onGround && (b.kind === 'beetleKing' || (b.phase === 'rest' && b.phaseT > 25));
    if (ready) {
      g.player.x = b.x + b.w / 2 - 11; g.player.y = b.y - 40; g.player.vy = 3; g.player.invuln = 0;
      for (let i = 0; i < 20 && g.boss && g.boss.inv === 0 && g.state.phase === 'play'; i++) g.step(1, false);
    } else { g.player.x = L.arena.a + 40; g.player.y = 9 * 32 - 30; g.player.vy = 0; g.player.invuln = 5; g.step(1, false); }
    if (g.state.phase !== 'play') return { fail: g.state.phase, n };
  }
  return { done: g.level.bossDone, n };
}`;

test.describe('jumper (Прыг-скок): уровни', () => {
  test('главное меню поверх заставки, в уровне правит игрок', async ({ page }) => {
    const errors = await openGame(page, 'jumper', 'seed=1');
    for (const t of ['Играть', 'Карта уровней', 'Настройки', 'Достижения и рекорды', 'Как играть', 'Об игре']) await expect(page.locator(`[data-screen=main] .kit-btn:has-text("${t}")`).first()).toBeVisible();
    expect(await page.evaluate(() => __game.autopilot)).toBe(true);
    await page.click('[data-screen=main] [data-id=play]');
    expect(await page.evaluate(() => ({ a: __game.autopilot, m: __game.kit.mode, lvl: __game.state.levelIdx }))).toEqual({ a: false, m: 'play', lvl: 0 });
    await expect(page).toHaveTitle(/не связана с правообладателем/);
    expect(errors).toEqual([]);
  });

  test('все 8 уровней проходимы по правилам прыжка (пружины и платформы учтены)', async ({ page }) => {
    await openGame(page, 'jumper', 'seed=1');
    for (let i = 0; i < 8; i++) {
      const r = await page.evaluate(`(${REACH})(${i})`);
      expect(r.reached, `уровень ${i + 1}: дошли до x=${r.best}, флаг ${r.goalX}`).toBe(true);
    }
  });

  test('обычный уровень: контрольные флажки, флаг, экран итога, открывается следующий', async ({ page }) => {
    await openGame(page, 'jumper', 'seed=1');
    await page.evaluate(() => { localStorage.clear(); __game.startLevel(0); });
    const ph = await page.evaluate(`(${FINISH})()`);
    expect(ph).toBe('clear');
    await expect(page.locator('[data-screen=levelClear]')).toBeVisible();
    await expect(page.locator('[data-screen=levelClear] .stars3')).toBeVisible();
    expect(await page.evaluate(() => [__game.progress.unlocked, __game.progress.levels[0].stars[0]])).toEqual([1, true]);
    await page.click('[data-screen=levelClear] [data-id=next]');
    expect(await page.evaluate(() => __game.state.levelIdx)).toBe(1);
  });

  test('звёзды: все монеты и норма времени дают три звезды, видны на карте и после перезагрузки', async ({ page }) => {
    await openGame(page, 'jumper', 'seed=1');
    await page.evaluate(() => {
      localStorage.clear(); const g = __game; g.startLevel(0);
      const all = g.level.coins.length + g.countGifts(g.LEVELS[0].build());
      for (const c of g.level.coins) c.taken = true;
      g.state.coins = all;
    });
    expect(await page.evaluate(`(${FINISH})()`)).toBe('clear');
    expect(await page.evaluate(() => __game.progress.levels[0].stars)).toEqual([true, true, true]);
    await page.reload();
    await page.waitForFunction(() => window.__game && __game.ready);
    await page.click('[data-screen=main] .kit-btn:has-text("Карта уровней")');
    await expect(page.locator('[data-level="0"] .stars3')).toHaveText('★★★');
    await expect(page.locator('[data-level="1"]')).toBeEnabled();
    await expect(page.locator('[data-level="2"]')).toBeDisabled();
  });

  test('Король жуков побеждается прыжками, после него - флаг и открыт второй мир', async ({ page }) => {
    await openGame(page, 'jumper', 'seed=1');
    await page.evaluate(() => { localStorage.clear(); __game.startLevel(3); });
    const r = await page.evaluate(`(${BEAT_BOSS})()`);
    expect(r.done).toBe(true);
    expect(await page.evaluate(`(${FINISH})()`)).toBe('clear');
    expect(await page.evaluate(() => [__game.progress.unlocked, !!__game.kit.unlocked.world1, !!__game.kit.unlocked.boss1])).toEqual([4, true, true]);
  });

  test('голема нельзя бить, пока у него шипы; когда отдыхает - можно', async ({ page }) => {
    await openGame(page, 'jumper', 'seed=1');
    const r = await page.evaluate(() => {
      const g = __game; g.startLevel(7); const L = g.level;
      g.player.x = L.arena.a + 80; g.player.y = 9 * 32 - 30; g.step(2, false);
      const b = g.boss; b.phase = 'walk'; b.phaseT = 100;
      g.player.x = b.x + b.w / 2 - 11; g.player.y = b.y - 40; g.player.vy = 3; g.player.invuln = 0;
      for (let i = 0; i < 20 && g.state.phase === 'play'; i++) g.step(1, false);
      const spiky = { hp: b.hp, phase: g.state.phase };
      g.step(80, false);                                    // смерть и возврат
      g.player.x = L.arena.a + 80; g.step(2, false);
      const b2 = g.boss; b2.phase = 'rest'; b2.phaseT = 100;
      g.player.x = b2.x + b2.w / 2 - 11; g.player.y = b2.y - 40; g.player.vy = 3; g.player.invuln = 0;
      for (let i = 0; i < 20 && b2.hp === b2.maxHp; i++) g.step(1, false);
      return { spiky, restHp: b2.hp, max: b2.maxHp };
    });
    expect(r.spiky.phase).toBe('dying');
    expect(r.restHp).toBe(r.max - 1);
  });

  test('после удара по боссу - короткая передышка: касание в первые кадры не ранит, позже ранит', async ({ page }) => {
    await openGame(page, 'jumper', 'seed=1');
    const r = await page.evaluate(() => {
      const g = __game; g.kit.set('difficulty', 'normal'); g.startLevel(3); g.clearEnemies();
      g.player.x = g.level.arena.a + 80; g.step(2, false);
      const b = g.boss; b.vx = 0; b.t = 1;
      g.player.x = b.x + b.w / 2 - 11; g.player.y = b.y - 40; g.player.vy = 3; g.player.invuln = 0;
      for (let i = 0; i < 20 && b.inv === 0; i++) g.step(1, false);
      const hit = b.hp === b.maxHp - 1;
      g.player.x = b.x - 12; g.player.y = b.y + b.h - g.player.h; g.player.vy = 0; g.player.invuln = 0;
      g.step(1, false);
      const early = g.state.phase;
      b.inv = 10; g.player.x = b.x - 12; g.player.y = b.y + b.h - g.player.h; g.player.vy = 0;
      g.step(1, false);
      return { hit, early, late: g.state.phase };
    });
    expect(r).toEqual({ hit: true, early: 'play', late: 'dying' });
  });

  test('после последнего уровня - экран победы с итогами', async ({ page }) => {
    await openGame(page, 'jumper', 'seed=1');
    await page.evaluate(() => { localStorage.clear(); __game.startLevel(7); });
    expect((await page.evaluate(`(${BEAT_BOSS})()`)).done).toBe(true);
    await page.evaluate(`(${FINISH})()`);
    await expect(page.locator('[data-screen=victory]')).toBeVisible();
    await expect(page.locator('[data-screen=victory]')).toContainText('Всего звёзд');
    expect(await page.evaluate(() => [__game.progress.done, !!__game.kit.unlocked.world2])).toEqual([true, true]);
  });
});

test.describe('jumper (Прыг-скок): правила', () => {
  test('автопилот честно проходит всю кампанию - 8 уровней и два босса - до экрана победы', async ({ page }) => {
    test.setTimeout(240000);
    await openGame(page, 'jumper', 'seed=1');
    await page.evaluate(() => localStorage.clear());
    const runs = [];
    for (let i = 0; i < 8; i++) {
      runs.push(await page.evaluate((i) => {
        const g = __game; g.kit.closeAll(); g.startLevel(i); g.setAutopilot(true);
        let n = 0, deaths = 0, was = 'play';
        while (n++ < 20000 && g.state.phase !== 'done' && g.state.phase !== 'over') {
          g.step(1, false);
          if (g.state.phase === 'dying' && was !== 'dying') deaths++;
          was = g.state.phase;
        }
        return { i, phase: g.state.phase, deaths };
      }, i));
    }
    expect(runs.filter((r) => r.phase !== 'done')).toEqual([]);
    expect(runs.reduce((n, r) => n + r.deaths, 0)).toBeLessThanOrEqual(2);
    await expect(page.locator('[data-screen=victory]')).toBeVisible();
    expect(await page.evaluate(() => [__game.progress.done, __game.progress.unlocked])).toEqual([true, 7]);
  });

  test('жизни по сложности 5/3/2; гибель возвращает к флажку, монеты второй раз не считаются', async ({ page }) => {
    await openGame(page, 'jumper', 'seed=1');
    const r = await page.evaluate(() => {
      const g = __game, out = {};
      for (const d of ['easy', 'normal', 'hard']) { g.kit.set('difficulty', d); g.startLevel(0); out[d] = g.state.lives; }
      g.kit.set('difficulty', 'normal'); g.startLevel(0); g.clearEnemies();
      const cp = g.level.checkpoints[0];
      const coin = g.level.coins[0]; g.player.x = coin.x; g.player.y = coin.y; g.step(1, false);
      const coinsAfter = g.state.coins;
      g.player.x = cp.x + 4; g.player.y = 9 * 32 - 30 + 0; g.step(2, false);
      g.player.invuln = 0; g.hurt(); g.step(80, false);
      const respawnX = g.player.x;
      g.player.x = coin.x; g.player.y = coin.y; g.step(1, false);
      return { out, coinsAfter, coinsAgain: g.state.coins, respawnX, cpX: cp.x, lives: g.state.lives };
    });
    expect(r.out).toEqual({ easy: 5, normal: 3, hard: 2 });
    expect(r.respawnX).toBe(r.cpX);
    expect(r.lives).toBe(2);
    expect(r.coinsAgain).toBe(r.coinsAfter);
  });

  test('прыжок сверху давит жука и пчелу, касание сбоку - гибель', async ({ page }) => {
    await openGame(page, 'jumper', 'seed=1');
    const r = await page.evaluate(() => {
      const g = __game; g.startLevel(0); g.clearEnemies(); g.step(5, false);
      const out = {};
      for (const kind of ['beetle', 'bee']) {
        const e = g.addEnemy(g.player.x, kind === 'bee' ? 200 : 320 - 24, kind); e.vx = 0;
        g.player.y = e.y - g.player.h - 20; g.player.vy = 4;
        for (let i = 0; i < 12 && e.alive; i++) g.step(1, false);
        out[kind] = !e.alive; g.step(40, false);
      }
      g.player.y = 320 - 30; g.player.vy = 0; g.step(2, false);
      g.addEnemy(g.player.x + g.player.w - 2, 320 - 24); g.step(2, false);
      out.side = g.state.phase;
      return out;
    });
    expect(r).toEqual({ beetle: true, bee: true, side: 'dying' });
  });

  test('движущаяся платформа везёт героя, пружина подбрасывает выше обычного прыжка, шипы опасны', async ({ page }) => {
    await openGame(page, 'jumper', 'seed=1');
    const r = await page.evaluate(() => {
      const g = __game; g.startLevel(2); g.clearEnemies();
      const m = g.level.movers[0]; g.step(1, false);
      g.player.x = m.x + 20; g.player.y = m.y - 40; g.player.vy = 0; g.step(10, false);
      const x0 = g.player.x, mx0 = m.x; g.step(40, false);
      const carried = Math.abs((g.player.x - x0) - (m.x - mx0)) < 0.5 && Math.abs(m.x - mx0) > 5;
      g.startLevel(6); g.clearEnemies();
      const s = g.level.springs[0];
      g.player.x = s.x; g.player.y = s.y - 60; g.player.vy = 2; let top = 9999;
      for (let i = 0; i < 60; i++) { g.step(1, false); top = Math.min(top, g.player.y); }
      const springRise = (s.y - 30) - top;
      g.startLevel(4); g.clearEnemies();
      const sp = g.level.spikes[0]; g.player.x = sp.x + 10; g.player.y = 320 - 30 - 2; g.player.invuln = 0; g.step(3, false);
      return { carried, springRise, spikes: g.state.phase };
    });
    expect(r.carried).toBe(true);
    expect(r.springRise).toBeGreaterThan(5 * 32);
    expect(r.spikes).toBe('dying');
  });

  test('прогресс и звёзды переживают перезагрузку: «Продолжить»', async ({ page }) => {
    await openGame(page, 'jumper', 'seed=1');
    await page.evaluate(() => { localStorage.clear(); __game.startLevel(0); });
    await page.evaluate(`(${FINISH})()`);
    await page.reload();
    await page.waitForFunction(() => window.__game && __game.ready);
    await page.click('[data-screen=main] [data-id=continue]');
    expect(await page.evaluate(() => [__game.state.levelIdx, __game.kit.mode])).toEqual([1, 'play']);
  });
});

test.describe('jumper (Прыг-скок): пауза, настройки, окно', () => {
  test('сложность меняет здоровье боссов (2/3/4) и скорость жуков', async ({ page }) => {
    await openGame(page, 'jumper', 'seed=1');
    const r = await page.evaluate(() => {
      const g = __game, out = {};
      for (const d of ['easy', 'normal', 'hard']) {
        g.kit.set('difficulty', d); g.startLevel(3);
        g.player.x = g.level.arena.a + 80; g.step(2, false);
        out[d] = { hp: g.boss.maxHp, v: Math.abs(g.boss.vx) };
        g.startLevel(0); out[d].beetle = Math.abs(g.level.enemies[0].vx);
      }
      return out;
    });
    expect([r.easy.hp, r.normal.hp, r.hard.hp]).toEqual([2, 3, 4]);
    expect(r.easy.beetle).toBeLessThan(r.normal.beetle);
    expect(r.normal.beetle).toBeLessThan(r.hard.beetle);
    expect(r.easy.v).toBeLessThan(r.hard.v);
  });

  test('громкость музыки и звуков меняет усиление и сохраняется', async ({ page }) => {
    await openGame(page, 'jumper', 'seed=1');
    await page.evaluate(() => __game.kit.audioCtx());
    await page.click('[data-screen=main] .kit-btn:has-text("Настройки")');
    await page.locator('input[data-setting=musicVol]').fill('30');
    await page.locator('input[data-setting=sfxVol]').fill('55');
    expect(await page.evaluate(() => [__game.kit.musicGain.gain.value, __game.kit.sfxGain.gain.value].map((v) => +v.toFixed(2)))).toEqual([0.3, 0.55]);
    await page.reload();
    await page.waitForFunction(() => window.__game && __game.ready);
    expect(await page.evaluate(() => [__game.kit.settings.musicVol, __game.kit.settings.sfxVol])).toEqual([0.3, 0.55]);
  });

  for (const size of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
    test(`пауза ${size.width}x${size.height}: надпись уровня не наезжает на окно «Пауза»`, async ({ page }) => {
      await page.setViewportSize(size);
      await openGame(page, 'jumper', 'seed=1');
      await page.click('[data-screen=main] [data-id=play]');
      await page.waitForTimeout(150);
      const r = await pauseLayout(page);
      expect(r.during).not.toBe(null);
      expect(r.overlap).toBe(false);
    });
  }

  test('скрытие вкладки и потеря фокуса - пауза; вернуть может только игрок', async ({ page }) => {
    await openGame(page, 'jumper', 'seed=1');
    await page.click('[data-screen=main] [data-id=play]');
    await page.evaluate(() => __game.kit.audioCtx());
    await hideTab(page); await showTab(page);
    expect(await page.evaluate(() => [__game.kit.mode, __game.kit.ctx.state !== 'closed'])).toEqual(['paused', true]);
    await page.click('[data-screen=pause] [data-id=resume]');
    await blurWindow(page); await focusWindow(page);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => __game.kit.mode)).toBe('paused');
  });

  test('прыжок переназначается на W', async ({ page }) => {
    await openGame(page, 'jumper', 'seed=1');
    await page.evaluate(() => localStorage.clear());
    await page.click('[data-screen=main] .kit-btn:has-text("Настройки")');
    await page.click('[data-bind="jump:0"]'); await page.keyboard.press('KeyW');
    await page.click('[data-screen=settings] .kit-btn:has-text("Готово")');
    await page.click('[data-screen=main] [data-id=play]');
    await page.evaluate(() => __game.clearEnemies());
    await page.keyboard.down('KeyW');
    const y = await page.evaluate(() => { const y0 = __game.player.y; __game.step(8, false); return y0 - __game.player.y; });
    await page.keyboard.up('KeyW');
    expect(y).toBeGreaterThan(20);
  });

  for (const size of [...SIZES, { width: 1920, height: 1080 }]) {
    test(`поле и меню влезают в окно ${size.width}x${size.height}, холст чёткий`, async ({ page }) => {
      await page.setViewportSize(size);
      await openGame(page, 'jumper');
      expectFits(expect, await fitReport(page, '#game'));
      expectFits(expect, await fitReport(page, '[data-screen=main] .kit-panel'));
      const c = await page.evaluate(() => { const c = document.getElementById('game'), r = c.getBoundingClientRect(); return c.width / r.width / devicePixelRatio; });
      expect(Math.abs(c - 1)).toBeLessThan(0.02);
    });
  }
});

test.describe('jumper (Прыг-скок): по ревью', () => {
  for (const vp of [{ width: 1280, height: 720 }, { width: 1366, height: 768 }]) {
    test(`между плитками земли нет светлых швов при дробном масштабе (${vp.width}x${vp.height})`, async ({ page }) => {
      await page.setViewportSize(vp);
      await openGame(page, 'jumper', 'seed=1');
      await page.click('[data-screen=main] [data-id=play]');
      const r = await page.evaluate(() => {
        const g = __game, th = g.THEMES.meadow;
        th.sky = ['#ff00ff', '#ff00ff']; th.hill = '#ff00ff'; th.hill2 = '#ff00ff'; th.cloud = null;
        g.clearEnemies(); g.player.x = 60; g.step(1, true);
        const c = document.getElementById('game'), k = c.width / g.W, x2 = c.getContext('2d');
        // земля: ряды 10-11 мира, под полосой счёта
        const y0 = Math.ceil((g.HUD_H + 10 * g.TILE + 4) * k), y1 = Math.floor((g.HUD_H + 12 * g.TILE - 2) * k);
        const d = x2.getImageData(0, y0, c.width, y1 - y0).data;
        let bad = 0;
        // у земли и травы синего меньше, чем зелёного; примесь пурпурного неба - это шов
        for (let i = 0; i < d.length; i += 4) if (d[i + 2] > d[i + 1] + 20) bad++;
        return { bad, k };
      });
      expect(r.k % 1).not.toBe(0);
      expect(r.bad).toBe(0);
    });
  }

  test('полоса счёта не закрывает верхний ряд потолка', async ({ page }) => {
    await openGame(page, 'jumper', 'seed=1');
    await page.click('[data-screen=main] [data-id=play]');
    const r = await page.evaluate(() => {
      const g = __game; g.startLevel(6); g.clearEnemies(); g.step(1, true);
      const c = document.getElementById('game'), k = c.width / g.W, x2 = c.getContext('2d');
      const ratio = c.getBoundingClientRect().height / c.getBoundingClientRect().width;
      // верхний ряд потолка виден под полосой: если его убрать, картинка в этом месте меняется
      const at = () => Array.from(x2.getImageData(Math.round(g.player.x - g.camX + 150) * k | 0, Math.round((g.HUD_H + 16) * k), 1, 1).data).join();
      const tx = Math.floor((g.player.x + 150) / g.TILE);
      const withCeiling = at(), ceiling = g.tileAt(tx, 0) !== g.T.EMPTY;
      for (let x = tx - 2; x <= tx + 2; x++) g.setTile(x, 0, g.T.EMPTY);
      g.step(1, true);
      return { ratio, want: g.VIEW_H / g.W, ceiling, changed: at() !== withCeiling };
    });
    expect(Math.abs(r.ratio - r.want)).toBeLessThan(0.01);
    expect(r.ceiling).toBe(true);
    expect(r.changed).toBe(true);
  });

  test('короткое нажатие прыжка между кадрами не теряется', async ({ page }) => {
    await openGame(page, 'jumper', 'seed=1');
    await page.click('[data-screen=main] [data-id=play]');
    const r = await page.evaluate(() => {
      const g = __game; g.clearEnemies(); g.step(5, false);
      const y0 = g.player.y;
      dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
      dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', bubbles: true }));
      let top = y0; for (let i = 0; i < 30; i++) { g.step(1, false); top = Math.min(top, g.player.y); }
      return y0 - top;
    });
    expect(r).toBeGreaterThan(8);
  });
});
