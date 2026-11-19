import type { StaticImageData } from "next/image";

import dogBengaluruAutoRickshaw from "@/assets/site-images/pages/dog-bengaluru-auto-rickshaw.jpg";
import dogsPariahYelahankaPark from "@/assets/site-images/pages/dogs-pariah-yelahanka-park.jpg";
import catLentilsWestBengal from "@/assets/site-images/pages/cat-lentils-west-bengal.jpg";
import artSuppliesFlatlayBlue from "@/assets/site-images/pages/art-supplies-flatlay-blue.jpg";
import classroomChennaiSmartClass from "@/assets/site-images/pages/classroom-chennai-smart-class.jpg";
import dogVestBlanketDelhi from "@/assets/site-images/pages/dog-vest-blanket-delhi.jpg";
import dogAndamanBeachSunset from "@/assets/site-images/pages/dog-andaman-beach-sunset.jpg";
import dogsVestsMatStall from "@/assets/site-images/pages/dogs-vests-mat-stall.jpg";
import dogDehradunGateGolden from "@/assets/site-images/pages/dog-dehradun-gate-golden.jpg";
import puppyGandenPeeking from "@/assets/site-images/pages/puppy-ganden-peeking.jpg";
import handPawFriendship from "@/assets/site-images/pages/hand-paw-friendship.jpg";
import snDogChirala from "@/assets/site-images/neighbours/sn-dog-chirala.jpg";
import snCatHorniman from "@/assets/site-images/neighbours/sn-cat-horniman.jpg";
import snCowUdaipur0837 from "@/assets/site-images/neighbours/sn-cow-udaipur-0837.jpg";
import snCrowMumbaiGrill from "@/assets/site-images/neighbours/sn-crow-mumbai-grill.jpg";
import snMynaGoregaon from "@/assets/site-images/neighbours/sn-myna-goregaon.jpg";
import snPigeonBalcony from "@/assets/site-images/neighbours/sn-pigeon-balcony.jpg";
import snSparrowCoimbatore from "@/assets/site-images/neighbours/sn-sparrow-coimbatore.jpg";
import snKiteBengaluru from "@/assets/site-images/neighbours/sn-kite-bengaluru.jpg";
import snSquirrelKolkata from "@/assets/site-images/neighbours/sn-squirrel-kolkata.jpg";
import snKoelFigs from "@/assets/site-images/neighbours/sn-koel-figs.jpg";
import seWaterJunglemyna from "@/assets/site-images/seasons/se-water-junglemyna.jpg";
import seShadeDogSoil from "@/assets/site-images/seasons/se-shade-dog-soil.jpg";
import seRainDogKhar from "@/assets/site-images/seasons/se-rain-dog-khar.jpg";
import seWinterDogCoatCurled from "@/assets/site-images/seasons/se-winter-dog-coat-curled.jpg";
import seKitesUttarayan from "@/assets/site-images/seasons/se-kites-uttarayan.jpg";
import careKolamRice from "@/assets/site-images/stories/care-kolam-rice.jpg";
import puppiesLoungingCloth from "@/assets/site-images/stories/puppies-lounging-cloth.jpg";
import dogAnjunaBeachHappy from "@/assets/site-images/happy/dog-anjuna-beach-happy.jpg";
import dogBhubaneswarBellyUp from "@/assets/site-images/happy/dog-bhubaneswar-belly-up.jpg";
import puppyWhiteRunning from "@/assets/site-images/happy/puppy-white-running.jpg";
import dogsLalbaghPlay from "@/assets/site-images/happy/dogs-lalbagh-play.jpg";
import puppiesKeralaGrass from "@/assets/site-images/happy/puppies-kerala-grass.jpg";
import dogThrissurHappyWhite from "@/assets/site-images/happy/dog-thrissur-happy-white.jpg";
import kittensBasketGuwahati from "@/assets/site-images/happy/kittens-basket-guwahati.jpg";
import kittenTreePeekaboo from "@/assets/site-images/happy/kitten-tree-peekaboo.jpg";
import catRoofBougainvillea from "@/assets/site-images/happy/cat-roof-bougainvillea.jpg";
import catStretchAhmedabad from "@/assets/site-images/happy/cat-stretch-ahmedabad.jpg";
import catGrassSrinagar from "@/assets/site-images/happy/cat-grass-srinagar.jpg";
import kittenTreeDingore from "@/assets/site-images/happy/kitten-tree-dingore.jpg";
import kittensPlayLalakapa from "@/assets/site-images/happy/kittens-play-lalakapa.jpg";

import focalPoints from "@/assets/site-images/focal.json";

import { type Credit, type SiteImageId, creditFor } from "./credits";

export type { Credit, SiteImageId } from "./credits";

// Static imports: hashed, immutable /_next/static/media files with width,
// height and a blur placeholder generated at build time.
const files: Record<SiteImageId, StaticImageData> = {
  "dog-bengaluru-auto-rickshaw": dogBengaluruAutoRickshaw,
  "dogs-pariah-yelahanka-park": dogsPariahYelahankaPark,
  "cat-lentils-west-bengal": catLentilsWestBengal,
  "art-supplies-flatlay-blue": artSuppliesFlatlayBlue,
  "classroom-chennai-smart-class": classroomChennaiSmartClass,
  "dog-vest-blanket-delhi": dogVestBlanketDelhi,
  "dog-andaman-beach-sunset": dogAndamanBeachSunset,
  "dogs-vests-mat-stall": dogsVestsMatStall,
  "dog-dehradun-gate-golden": dogDehradunGateGolden,
  "puppy-ganden-peeking": puppyGandenPeeking,
  "hand-paw-friendship": handPawFriendship,
  "sn-dog-chirala": snDogChirala,
  "sn-cat-horniman": snCatHorniman,
  "sn-cow-udaipur-0837": snCowUdaipur0837,
  "sn-crow-mumbai-grill": snCrowMumbaiGrill,
  "sn-myna-goregaon": snMynaGoregaon,
  "sn-pigeon-balcony": snPigeonBalcony,
  "sn-sparrow-coimbatore": snSparrowCoimbatore,
  "sn-kite-bengaluru": snKiteBengaluru,
  "sn-squirrel-kolkata": snSquirrelKolkata,
  "sn-koel-figs": snKoelFigs,
  "se-water-junglemyna": seWaterJunglemyna,
  "se-shade-dog-soil": seShadeDogSoil,
  "se-rain-dog-khar": seRainDogKhar,
  "se-winter-dog-coat-curled": seWinterDogCoatCurled,
  "se-kites-uttarayan": seKitesUttarayan,
  "care-kolam-rice": careKolamRice,
  "puppies-lounging-cloth": puppiesLoungingCloth,
  "dog-anjuna-beach-happy": dogAnjunaBeachHappy,
  "dog-bhubaneswar-belly-up": dogBhubaneswarBellyUp,
  "puppy-white-running": puppyWhiteRunning,
  "dogs-lalbagh-play": dogsLalbaghPlay,
  "puppies-kerala-grass": puppiesKeralaGrass,
  "dog-thrissur-happy-white": dogThrissurHappyWhite,
  "kittens-basket-guwahati": kittensBasketGuwahati,
  "kitten-tree-peekaboo": kittenTreePeekaboo,
  "cat-roof-bougainvillea": catRoofBougainvillea,
  "cat-stretch-ahmedabad": catStretchAhmedabad,
  "cat-grass-srinagar": catGrassSrinagar,
  "kitten-tree-dingore": kittenTreeDingore,
  "kittens-play-lalakapa": kittensPlayLalakapa,
};

// Subject position in each master, as [x, y] fractions, for object-position.
const focal = focalPoints as Record<SiteImageId, [number, number]>;

export type SiteImage = {
  id: SiteImageId;
  src: StaticImageData;
  credit: Credit;
  focal: [number, number];
};

/** A site photo with its credit. Unknown ids are a type error. */
export function siteImage(id: SiteImageId): SiteImage {
  return { id, src: files[id], credit: creditFor(id), focal: focal[id] };
}
