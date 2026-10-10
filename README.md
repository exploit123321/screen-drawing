# ScreenDrawing

ScreenDrawing lets you **draw on top of anything on your screen** and **take screenshots** that you can mark up before copying or saving them.

It is a small Windows program that sits in the system tray (the little icons near the clock). Press a shortcut and you can draw over your screen with a pen, arrows, boxes, text and more. Press another shortcut and you can cut out part of the screen, scribble on it, and copy it or save it as a picture.

Good for: presentations, screen sharing, explaining something on a call, or quickly marking up a screenshot.

---

## What you need

- A Windows 10 or Windows 11 computer.
- **Node.js** (free). This is only needed to run ScreenDrawing from this code or to build the installer.

> If someone already gave you the `ScreenDrawing Setup 1.0.0.exe` installer, you do not need Node.js. Just double-click the installer and follow the steps.

---

## Install and run it (step by step)

1. **Install Node.js**
   - Go to <https://nodejs.org> and download the version marked "LTS".
   - Run the downloaded file and click "Next" until it is done. The default options are fine.

2. **Download this project**
   - On the GitHub page of this project, click the green **Code** button, then **Download ZIP**.
   - Right-click the downloaded ZIP file and choose **Extract All**. Remember where the folder ends up.
   - (If you know Git, you can use `git clone` instead.)

3. **Open a terminal in the project folder**
   - Open the extracted `screen-drawing` folder in File Explorer.
   - Click the address bar at the top, type `cmd` and press **Enter**. A black window (the terminal) opens in that folder.

4. **Download the parts the app needs** (only the first time). Type this and press **Enter**:

   ```
   npm install
   ```

   This takes a minute or two and creates a `node_modules` folder.

5. **Start ScreenDrawing.** Type this and press **Enter**:

   ```
   npm start
   ```

   No big window opens. Instead, a small blue-purple icon appears in the system tray, and Windows shows a short message saying ScreenDrawing is running. If you don't see the icon, click the small up-arrow `^` next to the clock.

To close ScreenDrawing, right-click the tray icon and choose **Quit**.

---

## How to use it

### Keyboard shortcuts

| What you want to do | Press |
| --- | --- |
| Start or stop drawing on the screen | `Ctrl` + `Alt` + `D` |
| Take a screenshot of an area | `Ctrl` + `Alt` + `S` |
| While drawing: let clicks go through to the windows underneath (and back) | `Ctrl` + `Shift` + `X` |
| Close / cancel | `Esc` |
| Undo / redo | `Ctrl` + `Z` / `Ctrl` + `Y` |
| Make the line thicker or thinner | `Shift` + mouse wheel |
| Pick a tool | number keys `1` to `8` (see below) |

You can change the first three shortcuts: right-click the tray icon and choose **Settings...**. Click a box, then press the keys you want. Press `Backspace` in a box to clear it. In Settings you can also tick **Start ScreenDrawing when I sign in to Windows**.

You can also **left-click the tray icon** to start or stop drawing. Right-clicking it shows a menu with all actions.

### Drawing on the screen

When drawing is on, a toolbar appears at the top of the screen. You can move it by dragging the dotted handle on its left.

**Tools** (number key in brackets):

1. **Pen** - draw freely
2. **Eraser** - rub out parts of your drawing
3. **Arrow** - drag to draw an arrow
4. **Line** - drag to draw a straight line
5. **Rectangle** - drag to draw a box
6. **Ellipse** - drag to draw a circle or oval
7. **Highlighter** - a wide, see-through marker
8. **Text** - click where you want to type, then type. `Enter` finishes, `Shift` + `Enter` makes a new line.

**Colors:**

- You always have two colors: the **left mouse button** draws with the first color, the **right mouse button** draws with the second color.
- Click a color in the palette to set the first color. Right-click a color to set the second color.
- Click the two overlapping color circles to swap them.
- The custom color circle lets you pick any color you like (click for the first color, right-click for the second).

**Other buttons:** undo, redo, clear everything, and the thickness slider.

**Scrolling:** the mouse wheel still scrolls the window under your drawing. Your drawing stays where it is on the screen (it does not move with the page). The next click draws again.

**Click-through** (the mouse-pointer button, or `Ctrl` + `Shift` + `X`): your drawing stays visible, but your clicks go to the programs underneath, so you can keep working. Only the toolbar still reacts to clicks. Press the shortcut again to draw again, or `Esc` to close.

The three **capture buttons** on the right of the toolbar (rectangle, freehand, full screen) take a screenshot that includes your drawing. When you are done with the screenshot, you go back to your drawing.

### Taking a screenshot

1. Press `Ctrl` + `Alt` + `S` (or use the tray menu or a capture button on the toolbar).
2. The screen freezes and gets a little darker.
3. Choose how to select:
   - **Rectangle** - drag a box.
   - **Freehand** - draw any shape around what you want.
   - **Full screen** - takes the whole screen.

   Press `Tab` to switch between Rectangle and Freehand. The size of your selection (in real pixels) is shown next to it.
4. After selecting, the toolbar appears. You can draw on the screenshot with all the tools above.
5. Then:
   - **Copy** (or `Ctrl` + `C`, or `Enter`) puts the picture on the clipboard, ready to paste into a chat, email or document.
   - **Save** (or `Ctrl` + `S`) lets you save it as a `.png` or `.jpg` file. It suggests your Pictures folder.
   - `Esc` cancels.

A short message confirms when the picture was copied or saved. The toolbar itself never ends up in the picture. With Freehand, the area outside your shape is see-through in PNG files and white in JPG files.

---

## Make an installer (.exe)

You can turn ScreenDrawing into a normal Windows installer that you can share.

1. Do steps 1 to 4 from "Install and run it" above.
2. In the terminal, type:

   ```
   npm run dist
   ```

3. Wait a few minutes. When it is done, open the `dist` folder. You will find **`ScreenDrawing Setup 1.0.0.exe`** (about 110 MB). Double-click it to install ScreenDrawing like any other program. It adds a desktop shortcut and a Start menu entry.

If you only want the program files without an installer, type `npm run pack` instead. The program will be in `dist\win-unpacked\ScreenDrawing.exe`.

**If it goes wrong:**

- If you see an error like "Cannot create symbolic link", turn on Windows Developer Mode (Settings > System > For developers), or open the terminal as administrator once, and try again.
- When someone runs the installer, Windows may show a blue "Windows protected your PC" warning. This happens because the installer is not digitally signed. Click **More info**, then **Run anyway**.

---

## Good to know

- A screenshot selection stays on one monitor. Multiple monitors and different screen scaling settings are supported.
- ScreenDrawing does not need any special Windows permission. It only looks at the screen when you start a screenshot, and it only saves files where you tell it to.
- If a shortcut is already used by another program, ScreenDrawing tells you and opens Settings so you can choose different keys.
- Games running in "exclusive fullscreen" mode may hide the drawing. Switch the game to "borderless window" mode.
- Your settings are stored in `%APPDATA%\ScreenDrawing\settings.json`.

---

## How the code is organized

ScreenDrawing is built with [Electron](https://www.electronjs.org/), which lets you make desktop apps with web technology (HTML, CSS and JavaScript). No other tools (such as .NET or Visual Studio) are needed.

| File or folder | What it does |
| --- | --- |
| `package.json` | The project's name, its commands (`npm start`, `npm run dist`, ...) and the installer settings. |
| `src/main.js` | The "brain" of the app: the tray icon and menu, the keyboard shortcuts, one see-through window per monitor, taking the screenshot, copying and saving. |
| `src/overlay.html`, `src/overlay.css`, `src/overlay.js` | What you see on screen: the drawing surface, the toolbar, the tools, selecting an area and turning it into a picture. |
| `src/settings.html`, `src/settings.js` | The Settings window (shortcuts and start with Windows). |
| `src/preload.js` | A safe bridge that lets the on-screen windows talk to `main.js`. |
| `src/wheel.js` | Lets the mouse wheel scroll the window underneath while you draw. |
| `src/native.js` | Small Windows-only tweaks (for example, makes the overlay appear instantly without a fade). Uses the `koffi` library. If it is missing, the app still works. |
| `assets/icon.png` | The app icon. |
| `tools/make-icon.js` | Draws `assets/icon.png` again from code. Run it with `npm run icon`. |

**Commands:**

| Command | What it does |
| --- | --- |
| `npm install` | Downloads everything the app needs (first time only). |
| `npm start` | Runs ScreenDrawing from the code. |
| `npm run dist` | Builds the Windows installer into `dist/`. |
| `npm run pack` | Builds the program without an installer into `dist/win-unpacked/`. |
| `npm run icon` | Re-creates the app icon. |

**For developers:** setting the environment variable `SCREENDRAWING_DEBUG=1` prints timing information to the terminal. `SCREENDRAWING_SELFTEST=1` opens drawing mode, then a capture, and quits by itself after a few seconds (a quick "does it still start?" check).

---

## License

MIT. See [LICENSE](LICENSE).
