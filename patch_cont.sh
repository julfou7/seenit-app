sed -i '/<img/i \
        {show.networks && show.networks.length > 0 && show.networks[0].logo_path && (\
          <div className="absolute top-2 right-2 bg-white/90 backdrop-blur-md rounded-md p-1 px-1.5 shadow-lg max-w-[48px] max-h-[24px] flex items-center justify-center">\
            <img src={`https://image.tmdb.org/t/p/w92${show.networks[0].logo_path}`} alt={show.networks[0].name} className="w-full h-full object-contain filter invert opacity-90" />\
          </div>\
        )}' src/components/cards/ContinueWatchingCard.tsx
