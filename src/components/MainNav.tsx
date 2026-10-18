import { io } from "next/cache";
import { reviewQueue } from "@/lib/db";
import { NavLinks } from "./NavLinks";

// Navigation with the live number of posts waiting for review.
export async function MainNav() {
  await io();
  return <NavLinks reviewCount={reviewQueue().length} />;
}
