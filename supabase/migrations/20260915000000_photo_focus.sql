-- Where a plant's photo should be cropped, so the plant survives the crop.
--
-- Every surface renders the photo with `cover`, which centres what it cannot
-- fit. For a picture taken one-handed over a shelf that keeps the thumb and
-- drops the plant, and the user has no way to say otherwise. This column is
-- their answer: the fraction of the image HEIGHT the crop should centre on,
-- 0 at the top edge, 1 at the bottom.
--
-- The photograph itself is never touched. Framing is a fact about the plant
-- record, so it can be changed again at no cost and with no loss - unlike an
-- actual crop, which discards pixels and degrades on every adjustment.
--
-- Idempotent and additive, like the leaf_log migration before it. `0.5` is
-- exactly what `cover` already did, so existing rows are unchanged in effect
-- and no client build is required to read them.

alter table public.plants
  add column if not exists photo_focus_y real not null default 0.5;

-- A fraction, not a pixel offset and not a percentage. The client clamps what
-- it writes, but the column should not accept a value no renderer of ours can
-- use - an out-of-range number would crop to an edge on every device at once.
alter table public.plants drop constraint if exists plants_photo_focus_y_check;
alter table public.plants
  add constraint plants_photo_focus_y_check check (photo_focus_y >= 0 and photo_focus_y <= 1);
