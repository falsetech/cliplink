import { redirect } from "next/navigation";

/** A room URL with no code names no room, so it goes back to the entry point. */
export default function RoomIndexPage() {
  redirect("/");
}
