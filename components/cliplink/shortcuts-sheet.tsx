"use client";

import { Kbd as UiKbd, KbdGroup } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";

import { Kbd, useApplePlatform } from "./kbd";
import { Sheet, SheetHeader } from "./sheet";
import { AMBIENT_SHORTCUTS, type ActionGroup, type RoomAction } from "./room-actions";

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
      className="max-w-lg"
    >
      <ShortcutsBody actions={actions} />
    </Sheet>
  );
}

function ShortcutsBody({ actions }: { actions: RoomAction[] }) {
  const apple = useApplePlatform();
  const bound = actions.filter((action) => action.chord);

  return (
    <>
      <SheetHeader title="Keyboard Shortcuts" closeLabel="Close shortcuts" />

      <div className="-mr-1 flex max-h-[60vh] flex-col gap-5 overflow-y-auto pr-1">
        {GROUP_ORDER.map((group) => {
          const rows = bound.filter((action) => action.group === group);
          if (rows.length === 0) {
            return null;
          }

          return (
            <section key={group} className="flex flex-col gap-1">
              <h3 className="m-0 px-1 pb-1 text-xs font-semibold text-muted-foreground">
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

        <section className="flex flex-col gap-1">
          <h3 className="m-0 px-1 pb-1 text-xs font-semibold text-muted-foreground">
            Anywhere
          </h3>
          {AMBIENT_SHORTCUTS.map((entry) => (
            <Row key={entry.label} label={entry.label}>
              <KbdGroup>
                {entry.keys.map((key, index) =>
                  key === "–" ? (
                    <span key={index} className="px-0.5 text-muted-foreground">
                      –
                    </span>
                  ) : (
                    <UiKbd key={index}>{key}</UiKbd>
                  ),
                )}
              </KbdGroup>
            </Row>
          ))}
        </section>
      </div>

      <Separator />

      <p className="m-0 text-xs text-pretty text-muted-foreground">
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
    <div className="flex min-h-9 items-center justify-between gap-4 rounded-lg px-1">
      <span className="min-w-0 text-sm text-foreground">{label}</span>
      {children}
    </div>
  );
}
