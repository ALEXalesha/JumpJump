// Помощники для игр на общем каркасе kit.js: имитация скрытия и возврата вкладки,
// потеря и возврат фокуса окна, проверка, что надписи игры не наезжают на окно паузы.
async function setHidden(page, hidden) {
  await page.evaluate((h) => {
    Object.defineProperty(document, 'hidden', { value: h, configurable: true });
    Object.defineProperty(document, 'visibilityState', { value: h ? 'hidden' : 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}
const hideTab = (page) => setHidden(page, true);
const showTab = (page) => setHidden(page, false);
const blurWindow = (page) => page.evaluate(() => window.dispatchEvent(new Event('blur')));
const focusWindow = (page) => page.evaluate(() => window.dispatchEvent(new Event('focus')));

const intersects = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

// Надпись игры (__game.bannerCss()) видна в игре и не пересекается с окном паузы
async function pauseLayout(page) {
  const during = await page.evaluate(() => __game.bannerCss());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  const r = await page.evaluate(() => {
    const panel = document.querySelector('[data-screen=pause] .kit-panel').getBoundingClientRect();
    const title = document.querySelector('[data-screen=pause] h2').getBoundingClientRect();
    const box = (x) => ({ left: x.left, top: x.top, right: x.right, bottom: x.bottom });
    return { banner: __game.bannerCss(), panel: box(panel), title: box(title) };
  });
  return { during, ...r, overlap: !!(r.banner && (intersects(r.banner, r.panel) || intersects(r.banner, r.title))) };
}

module.exports = { hideTab, showTab, blurWindow, focusWindow, pauseLayout, intersects };
