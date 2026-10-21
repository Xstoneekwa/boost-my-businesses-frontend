import { fleetOperatorRequest } from "@/lib/instagram-dashboard/fleet-operator";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return fleetOperatorRequest(request, "read"); }
