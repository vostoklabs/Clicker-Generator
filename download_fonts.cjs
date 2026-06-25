const fs = require('fs');
const https = require('https');
const path = require('path');

const fonts = [
  { slug: 'bangers', url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/bangers/Bangers-Regular.ttf' },
  { slug: 'creepster', url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/creepster/Creepster-Regular.ttf' },
  { slug: 'fredoka-one', url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/fredokaone/FredokaOne-Regular.ttf' },
  { slug: 'permanent-marker', url: 'https://raw.githubusercontent.com/google/fonts/main/apache/permanentmarker/PermanentMarker-Regular.ttf' },
  { slug: 'sigmar-one', url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/sigmarone/SigmarOne-Regular.ttf' },
  { slug: 'luckiest-guy', url: 'https://raw.githubusercontent.com/google/fonts/main/apache/luckiestguy/LuckiestGuy-Regular.ttf' },
  { slug: 'bungee-shade', url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/bungeeshade/BungeeShade-Regular.ttf' },
  { slug: 'dancing-script', url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/dancingscript/DancingScript%5Bwght%5D.ttf' },
  { slug: 'amatic-sc', url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/amaticsc/AmaticSC-Regular.ttf' },
  { slug: 'playfair-display', url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf' },
  { slug: 'kalam', url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/kalam/Kalam-Regular.ttf' } 
];

async function download() {
  for (const {slug, url} of fonts) {
    console.log('Trying', slug);
    await new Promise((res) => {
      https.get(url, (response) => {
        if (response.statusCode === 200) {
          const file = fs.createWriteStream(path.join('public', 'fonts', slug + '.ttf'));
          response.pipe(file);
          file.on('finish', () => {
            file.close();
            console.log('Downloaded', slug);
            res();
          });
        } else {
          console.log('Failed', slug, response.statusCode);
          res();
        }
      }).on('error', (err) => {
        console.error(err);
        res();
      });
    });
  }
}
download();
