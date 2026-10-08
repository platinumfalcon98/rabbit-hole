import { CAPTIONS } from "./film"
import { Caption } from "./Caption"

export const Captions: React.FC = () => <>{CAPTIONS.map((c, i) => <Caption key={i} {...c} />)}</>
