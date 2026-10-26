<div align="center">

# JumpJump - Прыг-скок

**Прыг-скок - платформер на одной HTML-странице со своим героем, жуками, пчёлами и двумя боссами. Работает в браузере без сервера и без интернета: откройте `index.html` или играйте онлайн.**

[**▶ Играть онлайн →**](https://alexalesha.github.io/JumpJump/) &nbsp;·&nbsp; [English version of this file](README.md)

[![Status](https://img.shields.io/badge/status-stable-brightgreen)](#) [![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE) [![HTML5](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white)](https://developer.mozilla.org/docs/Web/HTML) [![Website](https://img.shields.io/badge/Website-open-0A84FF?logo=googlechrome&logoColor=white)](https://alexalesha.github.io/JumpJump/) [![Built with Claude Code](https://img.shields.io/badge/Built_with-Claude_Code-D97757?logo=claude&logoColor=white)](https://claude.com/claude-code)

Код, тесты и документация этого проекта написаны Claude (Anthropic) в Claude Code. Идеи, проверка и решения - Алексей.

</div>

> Фанатская игра, не связана ни с какими правообладателями. Герой, враги, блоки и боссы свои и нарисованы кодом.

![Меню](docs/screens/menu.png)

![Подземный уровень](docs/screens/play.png)

![Бой с боссом](docs/screens/boss.png)

## Что есть в игре

- **Два мира по четыре уровня:** Солнечная долина и Подземелья; четвёртый уровень мира - логово босса.
- Флажки посреди уровня - контрольные точки. Звёзды за уровень: пройти, собрать все монеты (и из подарочных блоков), уложиться в норму времени.
- Прыгайте на жуков и пчёл сверху, подарочный блок бейте снизу; оранжевая пружина подбрасывает высоко; шипы и ямы опасны.
- Боссы: Король жуков (прыжком по голове) и Каменный голем (бить, только когда он отдыхает и спрятал шипы).
- Карта уровней, достижения и рекорды, настройки, геймпад; музыка и звуки синтезируются WebAudio.

## Управление

| Клавиша | Действие |
|---|---|
| ← → или A / D | ходить |
| Shift или X | бежать |
| Пробел или ↑ | прыжок (держите - выше) |
| Esc | пауза |

Где игра это позволяет, клавиши меняются в настройках.

## Запуск у себя

Откройте `index.html` в Chrome, Edge или Firefox. Всё лежит в репозитории, ничего не скачивается.

## Проверки

Законы - проверки Playwright в `tests/`. Они открывают страницу по файловому адресу в безголовом
Chromium, по одной за раз:

```
npm install
npx playwright install chromium
npm test
```

Захват мыши в проверках всегда поддельный: настоящий `requestPointerLock` в безголовом Chromium
на Windows может зажать курсор пользователя.
Кадры выше сняты в безголовом браузере скриптом кадров сборника Hub.

## История

Игра сделана в сборнике [Hub](https://github.com/ALEXalesha/ALEXalesha.github.io), там она же работает в Хабе ([играть там](https://alexalesha.github.io/)). Здесь игра лежит вместе с историей коммитов.

## Лицензия

MIT, см. [LICENSE](LICENSE).
