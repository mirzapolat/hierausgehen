import { Caveat } from 'next/font/google';

const hand = Caveat({ subsets: ['latin'], weight: ['500'], display: 'swap' });

/**
 * Handgezeichnete Randnotiz: ein roter Pfeil, der von unten auf den Knopf
 * darüber zeigt, plus Text in Handschrift. Liegt absolut unter dem
 * umgebenden `relative`-Element und fängt keine Klicks ab.
 */
export function ScribbleHint({ text }: { text: string }) {
  return (
    <div
      aria-hidden
      className="scribble pointer-events-none absolute left-1/2 top-full mt-1 w-[190px] -translate-x-[62%] select-none"
    >
      <svg
        viewBox="0 0 190 80"
        className="scribble-arrow block h-[80px] w-[190px] overflow-visible"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path
          className="scribble-line"
          pathLength={1}
          d="M111 70 C 70 60, 106 32, 119 6"
        />
        <path className="scribble-head" pathLength={1} d="M108 12 C 112 10, 116 7, 119 5 C 120 9, 120 13, 122 17" />
      </svg>
      <p
        className={`${hand.className} scribble-text -mt-1 ml-14 w-max whitespace-nowrap text-[23px] leading-none -rotate-[4deg]`}
      >
        {text}
      </p>
    </div>
  );
}
