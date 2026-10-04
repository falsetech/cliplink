"use client";

import { useState, useSyncExternalStore } from "react";

import { Input } from "@/components/ui/input";
import { MAX_DEVICE_NAME_CHARS } from "@/lib/cliplink/constants";
import {
  getDeviceName,
  setDeviceName,
  subscribeToDeviceName,
} from "@/lib/cliplink/device";

import { Sheet, SheetHeader } from "./sheet";
import type { PresentDevice } from "./use-presence";

type DevicesSheetProps = {
  open: boolean;
  /** The other devices in the room. This one is shown separately. */
  devices: PresentDevice[];
  onClose: () => void;
};

/**
 * Who is in the room, and what this device is called there. Names are sealed
 * with the room key before they leave, so this list is something the devices
 * tell each other and the server never learns.
 */
export function DevicesSheet({ open, devices, onClose }: DevicesSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} label="Devices in this room">
      <DevicesSheetBody devices={devices} />
    </Sheet>
  );
}

function DevicesSheetBody({ devices }: Pick<DevicesSheetProps, "devices">) {
  const name = useSyncExternalStore(
    subscribeToDeviceName,
    getDeviceName,
    getDeviceName,
  );
  // Null while the field shows the saved name; a string while it is being
  // edited, so a rename from another sheet cannot overwrite what is typed.
  const [draft, setDraft] = useState<string | null>(null);

  function commit() {
    if (draft !== null) {
      setDeviceName(draft);
      setDraft(null);
    }
  }

  return (
    <>
      <SheetHeader title="Devices" closeLabel="Close devices" />

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          This device
        </span>
        <Input
          value={draft ?? name}
          maxLength={MAX_DEVICE_NAME_CHARS}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="done"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
      </label>

      <p className="-mt-2 m-0 text-xs text-pretty text-muted-foreground">
        Shown beside the clips you send. It is encrypted with the room key, so
        only devices in the room can read it.
      </p>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          Also in this room
        </span>
        {devices.length === 0 ? (
          <p className="m-0 rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
            No other device is connected right now.
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col divide-y divide-border rounded-2xl bg-muted p-0">
            {devices.map((device) => (
              <li
                key={device.id}
                className="truncate px-4 py-3 text-sm text-foreground"
              >
                {device.name ?? (
                  // A client from before names existed: present, but silent.
                  <span className="text-muted-foreground">Unnamed device</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
