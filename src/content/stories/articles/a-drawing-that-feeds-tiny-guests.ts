import type { ArticleBody } from "../model";

// Brief: research/stories.md §4 B; dossier S4. Kids' article: FK grade ≤ 6
// outside the grown-ups' box (checked in text.test.ts).
export const article = {
  blocks: [
    {
      type: "paragraph",
      text: [
        "Early in the morning, before the sun is up, a new drawing appears on a doorstep in Tamil Nadu. By the end of the day it is gone. Feet have walked over it. The wind has blown it. Ants and birds have eaten it.",
        { fn: "f2" },
        " Nobody is sad about this. It is meant to happen.",
      ],
    },
    { type: "heading", level: 2, text: "Dots, lines and loops" },
    {
      type: "paragraph",
      text: [
        "The drawing is called a kolam. Every day, millions of women in Tamil Nadu wake up before dawn to draw one at the door of their home.",
        { fn: "f1" },
        " Some kolams are small and simple. Some are big and full of loops.",
      ],
    },
    {
      type: "paragraph",
      text: [
        "In Tamil, the word kolam means beauty. It also means form, play, disguise and design.",
        { fn: "f2" },
        " That is a lot of meaning for one small word.",
      ],
    },
    {
      type: "paragraph",
      text: [
        "In the cool month of Margazhi, in December and January, many families draw bigger kolams than on other days.",
        { fn: "f6" },
        { fn: "f7" },
      ],
    },
    { type: "heading", level: 2, text: "Why rice flour?" },
    {
      type: "paragraph",
      text: [
        "Kolams are made with rice flour.",
        { fn: "f1" },
        " The white flour shows up well on the ground. And rice flour is food. When the women draw with it, they feed the insects and small animals that live near them.",
        { fn: "f3" },
        " They think of these tiny creatures as neighbours.",
        { fn: "f3" },
      ],
    },
    {
      type: "paragraph",
      text: [
        "The writer Vijaya Nagarajan has studied kolams for many years. She calls the kolam “a ritual of generosity”.",
        { fn: "f4" },
        " A ritual is something people do again and again, in the same way. Generosity means giving to others, happily. So a kolam is a way of giving, every single day.",
      ],
    },
    { type: "heading", level: 2, text: "Who comes to eat?" },
    {
      type: "paragraph",
      text: [
        "Ants come. They find the flour and carry tiny bits of it home. Birds come too, and other bugs and insects.",
        { fn: "f4" },
      ],
    },
    {
      type: "paragraph",
      text: [
        "Think of it as breakfast, laid out at the door. The guests are very small, and there are a lot of them. That is why Nagarajan named her book about kolams ",
        { em: "Feeding a Thousand Souls" },
        ".",
        { fn: "f1" },
      ],
    },
    { type: "heading", level: 2, text: "Art that is meant to fade" },
    {
      type: "paragraph",
      text: [
        "Most art is made to last. A painting goes in a frame. A statue stands in a park for years. A kolam is not like that. It is gone in a few hours.",
        { fn: "f2" },
      ],
    },
    {
      type: "paragraph",
      text: [
        "Then, the next morning, someone draws a new one. A kolam is a gift that is given again and again. It asks for nothing back.",
      ],
    },
    { type: "heading", level: 2, text: "Kolam today" },
    {
      type: "paragraph",
      text: [
        "Today, more and more people draw kolams with stone powder or paint.",
        { fn: "f4" },
        " One writer remembers her family moving from rice flour to limestone powder in the 1990s.",
        { fn: "f5" },
        " Stone and paint last longer. But ants and birds cannot eat them.",
      ],
    },
    {
      type: "paragraph",
      text: [
        "Feeding tiny creatures is not the only reason people draw kolams. For many families, a kolam is also a prayer and a way to say welcome.",
        { fn: "f6" },
        " But a kolam made with rice flour still shares a little food with the smallest guests.",
      ],
    },
    {
      type: "paragraph",
      text: [
        "At Friends of Animals, we love art that is kind. A kolam is both at once: a picture for people, and a meal for ants.",
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "For grown-ups",
      body: [
        [
          "Kolam is a living Tamil tradition, drawn mostly by women at the threshold of the home. Vijaya Nagarajan’s study, ",
          {
            em: "Feeding a Thousand Souls: Women, Ritual, and Ecology in India",
          },
          " (Oxford University Press, 2018), is the standard work in English.",
          { fn: "f1" },
          " Families give the kolam many meanings, among them welcome, prosperity and asking the earth’s forgiveness; feeding small creatures is one important meaning, not the only one.",
          { fn: "f6" },
        ],
        [
          "If your child tries the activity below, keep it outdoors so ants stay outside, and use plain rice flour with nothing added.",
        ],
      ],
    },
    {
      type: "callout",
      tone: "success",
      title: "What you can do this week",
      body: [
        [
          "With a grown-up’s okay, draw a small kolam with a spoonful of rice flour on the step outside your door, or on a balcony tile. Keep it outdoors, so the ants stay outside.",
        ],
        [
          "Check it after an hour, and again after lunch. Draw what you see: ant trails, a bird, a footprint.",
        ],
        [
          "Ask a grandparent or a neighbour about the doorstep patterns they grew up with. Copy one on paper.",
        ],
      ],
    },
  ],
  footnotes: [
    {
      id: "f1",
      text: "Vijaya Nagarajan, Feeding a Thousand Souls (Oxford University Press, 2018), book website",
      url: "https://feedingathousandsouls.com/",
    },
    {
      id: "f2",
      text: "University of San Francisco, Thacher Gallery, “Feeding a Thousand Souls” exhibition, 6 Mar–7 Apr 2019",
      url: "https://www.usfca.edu/thacher-gallery/feeding-thousand-souls",
    },
    {
      id: "f3",
      text: "BBC Reel, video on the kolam, 3 Jul 2019",
      url: "https://bbc.com/reel/video/p07fhbkb/watch",
    },
    {
      id: "f4",
      text: "Atlas Obscura, “Indian rice art kolam”, 7 May 2019",
      url: "https://www.atlasobscura.com/articles/indian-rice-art-kolam",
    },
    {
      id: "f5",
      text: "The New Indian Express, “Connecting the dots”, 2 Feb 2020",
      url: "https://www.newindianexpress.com/magazine/voices/2020/Feb/02/connecting-the-dots-2096776.html",
    },
    {
      id: "f6",
      text: "Nature inFocus, “Kolam: the art of everyday sustainability” (undated)",
      url: "http://natureinfocus.in/partnerships/vana-katha/kolam-the-art-of-everyday-sustainability",
    },
    {
      id: "f7",
      text: "The New Indian Express, “Kolam: art rooted in ritual”, 20 Dec 2025",
      url: "https://www.newindianexpress.com/cities/chennai/2025/Dec/20/kolam-art-rooted-in-ritual",
    },
  ],
} satisfies ArticleBody;
