import { cookies } from "next/headers";
import { isRestaurantLang, RESTAURANT_LANG_COOKIE, restaurantCommonCopy, type RestaurantLang } from "@/lib/restaurant-language";

export async function getRestaurantServerLang(): Promise<RestaurantLang> {
  const cookieStore = await cookies();
  const cookieLang = cookieStore.get(RESTAURANT_LANG_COOKIE)?.value;

  return isRestaurantLang(cookieLang) ? cookieLang : "en";
}

export async function getRestaurantServerCopy() {
  const lang = await getRestaurantServerLang();
  return {
    lang,
    copy: restaurantCommonCopy[lang],
  };
}
