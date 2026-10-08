import "@/styles/sculptures.css";

type SculptureKind = "memory" | "signer" | "shield" | "enclave";
const RING =
  "M218 56Q240 44 262 56L402 132Q430 148 402 164L262 240Q240 252 218 240L78 164Q50 148 78 132ZM218 99L132 145Q126 148 132 151L218 198Q240 210 262 198L348 151Q354 148 348 145L262 99Q240 87 218 99Z";

/** Resolution-independent illustrations: separate planes animate without touching the copy. */
export function Sculpture({ kind = "memory" }: { kind?: SculptureKind }) {
  return (
    <div className={`badge-sculpture badge-sculpture-${kind}`} aria-hidden="true">
      <svg viewBox="0 0 480 400" fill="none">
        {kind === "memory" ? (
          <>
            <ellipse cx="240" cy="352" rx="128" ry="15" fill="#443477" opacity=".1" />
            {[92, 46, 0].map((y, i) => (
              <g key={y} className={`sculpture-layer sculpture-layer-${i}`}>
                <g transform={`translate(0 ${y})`}>
                  <path d={RING} transform="translate(0 23)" fill="#53408a" fillRule="evenodd" />
                  <path d={RING} transform="translate(0 12)" fill="#53408a" fillRule="evenodd" />
                  <path d={RING} fill={i === 2 ? "#faf8ff" : "#987ed3"} fillRule="evenodd" />
                  <path
                    d="M262 56 402 132Q430 148 402 164L348 151Q354 148 348 145L262 99Q250 93 240 92L262 56Z"
                    fill={i === 2 ? "#e4dcf9" : "#8066bd"}
                  />
                </g>
              </g>
            ))}
          </>
        ) : kind === "signer" ? (
          <g className="sculpture-object" transform="rotate(-12 240 210)">
            <path d="M185 122V88a55 55 0 0 1 110 0v34" stroke="#717582" strokeWidth="22" />
            <rect x="132" y="108" width="226" height="265" rx="53" fill="#202431" />
            <rect
              x="126"
              y="102"
              width="226"
              height="265"
              rx="53"
              fill="#373d4c"
              stroke="#777e8b"
              strokeWidth="3"
            />
            <rect x="150" y="137" width="178" height="174" rx="9" fill="#151925" />
            <rect x="159" y="146" width="160" height="156" rx="3" fill="#c2cce0" />
            <path
              d="m213 233 18 18 38-46"
              stroke="#30384b"
              strokeWidth="9"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <rect x="212" y="328" width="54" height="15" rx="7" fill="#191e28" />
          </g>
        ) : kind === "shield" ? (
          <g className="sculpture-object">
            <path d="M110 320V205h48v115M172 320V162h48v158M234 320V113h48v207" fill="#516da5" />
            <path d="M296 320V77h48v243" fill="#b66178" />
            <path
              d="m240 108 111 44v72c0 72-51 112-111 137-60-25-111-65-111-137v-72Z"
              fill="#e2e8f7"
              stroke="#fafaff"
              strokeWidth="4"
            />
            <path d="m240 126 94 36v62c0 61-41 97-94 119Z" fill="#bccce9" />
            <path
              d="m210 224 21 21 42-48"
              stroke="#405781"
              strokeWidth="10"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        ) : (
          <g className="sculpture-object">
            <path d="m240 107 104 58v116l-104 60-104-60V165Z" fill="#b36e4c" />
            <path d="m240 107 104 58-104 60-104-60Z" fill="#ffe0c5" />
            <path d="m240 225 104-60v116l-104 60Z" fill="#915031" />
            <ellipse
              cx="240"
              cy="222"
              rx="190"
              ry="65"
              transform="rotate(-28 240 222)"
              stroke="#713f29"
              strokeWidth="7"
            />
            <circle cx="396" cy="133" r="18" fill="#fff0df" />
            <circle cx="81" cy="305" r="12" fill="#713f29" />
          </g>
        )}
      </svg>
    </div>
  );
}
