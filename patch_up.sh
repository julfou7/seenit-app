sed -i '/<div className="w-\[72px\] h-\[72px\]/s/$/ relative/' src/components/cards/UpcomingShowCard.tsx
sed -i '/<img/i \
        {show.networks && show.networks.length > 0 && show.networks[0].logo_path && (\
          <div className="absolute top-1 right-1 bg-white/90 backdrop-blur-md rounded-md p-0.5 px-1 shadow-md max-w-[32px] max-h-[16px] flex items-center justify-center">\
            <img src={`https://image.tmdb.org/t/p/w92${show.networks[0].logo_path}`} alt={show.networks[0].name} className="w-full h-full object-contain" />\
          </div>\
        )}' src/components/cards/UpcomingShowCard.tsx
