import { Composition } from 'remotion';
import { Promo, promoLength } from './Promo';
import { STORY, FEED } from './script';

export const Root: React.FC = () => (
  <>
    {/* Instagram story: 9:16, short and punchy */}
    <Composition
      id="Story"
      component={Promo}
      durationInFrames={promoLength(STORY)}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{ cut: STORY }}
    />
    {/* LinkedIn feed: 4:5, a little longer, says what the project is */}
    <Composition
      id="Feed"
      component={Promo}
      durationInFrames={promoLength(FEED)}
      fps={30}
      width={1080}
      height={1350}
      defaultProps={{ cut: FEED }}
    />
  </>
);
