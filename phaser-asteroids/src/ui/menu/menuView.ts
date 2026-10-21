import type Phaser from 'phaser';
import { MenuController, type FocusSource, type MenuPageSpec } from './menuController';
import { PageKit } from './widgets';

/** What a page builder returns: everything of a `MenuPageSpec` except the parts the view fills in (its id, its items and cleaning up after it). */
export type PageDef = Omit<MenuPageSpec, 'id' | 'items'>;
/** Builds one page into `kit`: creates its widgets and texts, and describes its hotkeys and back action. */
export type PageBuilder = (kit: PageKit) => PageDef;

/**
 * Puts a `MenuController` on a scene: builds each page when it opens (and throws it away when it closes, so nothing stale or hidden is
 * left behind), forwards the mouse and fingers to the controller, and redraws the open page each frame. The scene forwards keys and
 * controller buttons itself (it knows its own global keys), through `controller.key` and `controller.pad`.
 *
 * Exactly one set of pointer listeners per view, removed when the scene shuts down or the view is destroyed, so opening and closing
 * menus any number of times never stacks handlers.
 */
export class MenuView {
  readonly controller: MenuController;
  private kit: PageKit | null = null;
  private open = false;
  private destroyed = false;
  private readonly stop: () => void;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depth: number,
    private readonly builders: Readonly<Record<string, PageBuilder>>,
    root: string,
  ) {
    this.controller = new MenuController((id) => this.buildPage(id), root, () => performance.now());

    const input = scene.input;
    const down = (pointer: Phaser.Input.Pointer): void => {
      if (this.open) this.controller.pointerDown(pointer.x, pointer.y, pointer.wasTouch ? 'touch' : 'mouse');
    };
    const move = (pointer: Phaser.Input.Pointer): void => {
      if (this.open) this.controller.pointerMove(pointer.x, pointer.y, pointer.wasTouch ? 'touch' : 'mouse');
    };
    const up = (): void => this.controller.pointerUp();
    input.on('pointerdown', down);
    input.on('pointermove', move);
    input.on('pointerup', up);
    input.on('pointerupoutside', up);
    this.stop = () => {
      input.off('pointerdown', down);
      input.off('pointermove', move);
      input.off('pointerup', up);
      input.off('pointerupoutside', up);
    };
    scene.events.once('shutdown', () => this.destroy());
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Builds the root page and starts reacting to input. `source` says what opened it: a finger gets no focus ring until a key or button is used. */
  show(source: FocusSource = 'keys'): void {
    this.open = true;
    this.controller.source = source;
    this.controller.start();
  }

  /** Closes every page and stops reacting to input (the pause menu on resume). */
  hide(): void {
    this.open = false;
    this.controller.closeAll();
  }

  update(now: number): void {
    if (!this.open) return;
    this.controller.refresh();
    this.kit?.sync(this.controller.focusId, this.controller.focusVisible, this.controller.pressedId, now);
  }

  private buildPage(id: string): MenuPageSpec {
    const builder = this.builders[id];
    if (!builder) throw new Error(`no menu page "${id}"`);
    const kit = new PageKit(this.scene, this.depth);
    this.kit = kit;
    const def = builder(kit);
    return {
      ...def,
      id,
      items: kit.widgets,
      dispose: () => {
        def.dispose?.();
        kit.destroy();
        if (this.kit === kit) this.kit = null;
      },
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.open = false;
    this.stop();
    this.controller.destroy();
  }
}
