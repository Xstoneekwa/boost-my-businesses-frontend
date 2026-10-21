import { fleetOperatorRequest } from "@/lib/instagram-dashboard/fleet-operator";
export async function POST(request: Request) { return fleetOperatorRequest(request, "preview"); }
