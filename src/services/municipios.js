const db = require('../database/db');

async function getMunicipiosNoRaio(municipioBase, uf, raioKm) {
  const { rows: base } = await db.query(
    `SELECT lat, lng FROM municipios_ibge
     WHERE LOWER(nome) ILIKE LOWER($1) AND uf = $2
     LIMIT 1`,
    [municipioBase, uf],
  );
  if (!base.length) throw new Error(`Município "${municipioBase}" não encontrado em ${uf}`);

  const { lat: latBase, lng: lngBase } = base[0];

  const { rows } = await db.query(
    `SELECT nome, uf, codigo_ibge,
            (6371 * acos(
              LEAST(1, cos(radians($1)) * cos(radians(lat))
              * cos(radians(lng) - radians($2))
              + sin(radians($1)) * sin(radians(lat)))
            )) AS distancia_km
     FROM municipios_ibge
     WHERE uf = $3
       AND (6371 * acos(
         LEAST(1, cos(radians($1)) * cos(radians(lat))
         * cos(radians(lng) - radians($2))
         + sin(radians($1)) * sin(radians(lat)))
       )) <= $4
     ORDER BY distancia_km`,
    [latBase, lngBase, uf, raioKm],
  );
  return rows;
}

module.exports = { getMunicipiosNoRaio };
