/**
 * "If you find a hurt or scared animal" and bite first aid, based on NCDC,
 * WHO and AWBI guidance.
 */

export type Step = { title: string; text: string };
export type Source = { label: string; url: string };

/** Six big steps for children (Flesch-Kincaid grade ≤ 6). */
export const HURT_ANIMAL_KID_STEPS: readonly string[] = [
  "Stop. Stay back. Do not touch the animal.",
  "Tell a grown-up you trust, right now.",
  "Keep other people and pets away. Speak softly.",
  "Help the grown-up find a rescue group or a vet.",
  "Never give a hurt bird water or food.",
  "If you were bitten or scratched, wash it and see a doctor today.",
];

export const HURT_ANIMAL_GROWN_UP: readonly Step[] = [
  {
    title: "Stay safe first",
    text: "Don’t put yourself at risk on roads, roofs or near power lines. Scared animals bite. Wear thick gloves and long sleeves, and bring a second person.",
  },
  {
    title: "Keep it calm",
    text: "Keep children and pets away. Avoid noise, staring and handling.",
  },
  {
    title: "Call before you act",
    text: "Ring your saved local rescue, an animal welfare organisation or a vet. For cattle and other livestock, many states run a 1962 mobile veterinary unit; hours vary. Describe the exact location: vague calls slow rescuers down.",
  },
  {
    title: "If you are asked to contain a small bird or animal",
    text: "Cover it gently with a towel and place it in a cardboard box with air holes, never a wire cage. Keep the box warm, dark and quiet. Give no food or water. If it is caught in kite string, don’t pull: let a trained rescuer cut it.",
  },
  {
    title: "Leave these to trained help",
    text: "Birds of prey such as kites, monkeys, snakes, cattle, and any dog or cat that is aggressive or behaving strangely.",
  },
  {
    title: "Babies are usually not lost",
    text: "Fledglings on the ground are normally fine: their parents are nearby. Watch kittens from far away for hours before deciding they are alone. Keep away from puppies with their mother.",
  },
  {
    title: "Several dead or sick birds",
    text: "Don’t touch them. Report them to the local veterinary or animal husbandry office.",
  },
  {
    title: "Cruelty",
    text: "Beating, poisoning or tying crackers to animals are offences under the PCA Act, s.11 and the BNS, s.325. Call the police. You can also tell AWBI or your district SPCA.",
  },
];

/** NCDC National Guidelines for Rabies Prophylaxis (2019) and WHO. */
export const BITE_FIRST_AID: readonly Step[] = [
  {
    title: "Wash",
    text: "Wash every bite or scratch at once with soap and plenty of running water for 15 minutes. No soap? Use water alone.",
  },
  {
    title: "Antiseptic",
    text: "Then apply povidone-iodine or another antiseptic. Don’t touch the wound with bare hands.",
  },
  {
    title: "Nothing else on it",
    text: "Never put chilli, oil, turmeric or lime on a bite, or soil, herbs or betel leaves.",
  },
  {
    title: "See a doctor",
    text: "Go the same day: even a small scratch can need the anti-rabies vaccine. Finish the full course. The vaccine is free at public health facilities; call ahead in case of a local shortage.",
  },
];

/** AWBI does not run a rescue helpline, and there is no national animal number. */
export const SAVE_A_NUMBER_SOURCES: readonly Source[] = [
  {
    label: "AWBI, list of recognised animal welfare organisations",
    url: "https://www.awbi.gov.in/view/index/list-of-awo",
  },
  {
    label: "Kerala AHD, 1962 call centre and mobile veterinary unit",
    url: "https://ahd.kerala.gov.in/en/mobile-veterinary-unit",
  },
];

export const RESCUE_SOURCES: readonly Source[] = [
  {
    label:
      "Tufts Wildlife Clinic, what to do if you find a sick or injured bird",
    url: "https://vet.tufts.edu/tufts-wildlife-clinic/found-wildlife/what-do-if-you-found-sick-or-injured-other-birds",
  },
  {
    label: "Cornell Lab, “I found a baby bird. What do I do?”",
    url: "https://www.allaboutbirds.org/news/i-found-a-baby-bird-what-do-i-do/",
  },
  {
    label: "NCDC, National Guidelines for Rabies Prophylaxis, 2019",
    url: "https://ncdc.mohfw.gov.in/uploads/pdf/COH14.pdf",
  },
  {
    label: "WHO, Rabies fact sheet",
    url: "https://www.who.int/news-room/fact-sheets/detail/rabies",
  },
  {
    label: "PIB, steps taken to strengthen rabies treatment, 19 Aug 2025",
    url: "https://www.pib.gov.in/PressReleasePage.aspx?PRID=2157880",
  },
  ...SAVE_A_NUMBER_SOURCES,
];

export const PCA_ACT_URL =
  "https://indiacode.nic.in/bitstream/123456789/11237/1/the_prevention_of_cruelty_to_animals_act,_1960.pdf";
