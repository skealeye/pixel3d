/** A phone-sized screen: narrow (portrait) or short (landscape). Everything else keeps the PC layout. */
export const PHONE_QUERY = '(max-width: 700px), (max-height: 500px)';

/** The same test as `PHONE_QUERY`, for sizes in px. */
export const isPhone = (width: number, height: number) => width <= 700 || height <= 500;
