// The music plus one <Audio> per scheduled cue.
import { Audio, Sequence, staticFile } from "remotion"
import { filmCues } from "./film"
import { DEFAULT_GAIN, cueFile } from "./files"

export const MUSIC_GAIN = 0.8

export const Soundtrack: React.FC<{ music?: boolean }> = ({ music = true }) => {
  const cues = filmCues()
  return (
    <>
      {music && <Audio src={staticFile("local/quartz.wav")} volume={MUSIC_GAIN} />}
      {cues.map((c, i) => (
        <Sequence key={i} from={c.frame} durationInFrames={c.sound === "drone" ? 360 : 240} layout="none">
          <Audio src={staticFile(cueFile(c))} volume={(c.gain ?? 1) * DEFAULT_GAIN[c.sound]} />
        </Sequence>
      ))}
    </>
  )
}
