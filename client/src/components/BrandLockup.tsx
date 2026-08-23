/** Oxbridge Ledger: supplied KSLO English logo in the established editorial tile. */
const brandLogo = `${import.meta.env.BASE_URL}assets/kslo-english-logo-blue.png`;

export function BrandLockup({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand-lockup${compact ? " brand-lockup--compact" : ""}`}>
      <span className="brand-mark" aria-hidden="true">
        <img src={brandLogo} alt="" />
      </span>
      <span className="brand-copy">
        <span>K S Lo English</span>
        <strong>Oxbridge Vocab Challenge</strong>
      </span>
    </div>
  );
}
