"use client";

import { Kbd, useApplePlatform } from "./kbd";
import { Sheet, useSheetClose } from "./sheet";
import { IconX } from "./icons";
import { AMBIENT_SHORTCUTS, type ActionGroup, type RoomAction } from "./room-actions";
import { panelSurfaceStyle } from "./ui";

const GROUP_ORDER: ActionGroup[] = ["Clip", "Room", "Files", "View"];

type ShortcutsSheetProps = {
  open: boolean;
  actions: RoomAction[];
  onClose: () => void;
};

export function ShortcutsSheet({ open, actions, onClose }: ShortcutsSheetProps) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      label="Keyboard shortcuts"
      className="max-w-125"
      style={panelSurfaceStyle}
    >
      <ShortcutsBody actions={actions} />
    </Sheet>
  );
}

function ShortcutsBody({ actions }: { actions: RoomAction[] }) {
  const close = useSheetClose();
  const apple = useApplePlatform();
  const bound = actions.filter((action) => action.chord);

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="mb-1.5 text-2xs text-muted-foreground uppercase">
            Reference
          </p>
          <h2 className="m-0 font-display text-2xl tracking-display text-foreground">
            Shortcuts
          </h2>
        </div>
        <button
          className="-m-2 inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:text-foreground active:scale-[0.96]"
          type="button"
          aria-label="Close shortcuts"
          onClick={() => close()}
        >
          <IconX size={16} />
        </button>
      </div>

      <div className="-mr-1 flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
        {GROUP_ORDER.map((group) => {
          const rows = bound.filter((action) => action.group === group);
          if (rows.length === 0) {
            return null;
          }

          return (
            <section key={group} className="flex flex-col gap-1.5">
              <h3 className="m-0 text-2xs text-muted-foreground uppercase">
                {group}
              </h3>
              {rows.map((action) => (
                <Row key={action.id} label={action.label}>
                  <Kbd chord={action.chord!} />
                </Row>
              ))}
            </section>
          );
        })}

        <section className="flex flex-col gap-1.5">
          <h3 className="m-0 text-2xs text-muted-foreground uppercase">
            Anywhere
          </h3>
          {AMBIENT_SHORTCUTS.map((entry) => (
            <Row key={entry.label} label={entry.label}>
              <span className="inline-flex items-center gap-0.5">
                {entry.keys.map((key, index) =>
                  key === "–" ? (
                    <span key={index} className="px-0.5 text-muted-foreground">
                      –
                    </span>
                  ) : (
                    <kbd
                      key={index}
                      className="inline-flex min-w-5 items-center justify-center rounded-[4px] border border-input px-1 py-px font-mono text-2xs text-muted-foreground"
                    >
                      {key}
                    </kbd>
                  ),
                )}
              </span>
            </Row>
          ))}
        </section>
      </div>

      <p className="m-0 text-2xs text-pretty text-muted-foreground">
        Single letters work whenever the compose box is not focused.{" "}
        {apple ? "⌘K" : "Ctrl+K"} opens the command palette from anywhere.
      </p>
    </>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg px-1 py-1">
      <span className="min-w-0 text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
