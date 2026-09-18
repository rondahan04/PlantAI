-- How close in a plant's photo is framed, beside where it is framed.
--
-- `photo_focus_y` (the migration before this) says which point down the image
-- sits at the centre of the frame. This says how big the image is drawn,
-- as a multiplier on the fit that exactly covers the frame:
--
--   1    fills the frame, which is what every surface did before either
--        column existed, and is therefore the default for every existing row
--   > 1  crops tighter
--   < 1  shrinks the picture until the whole photograph is visible, with
--        background around it
--
-- Relative to the cover fit rather than to the image's own pixels, so one
-- saved value is correct on a 56pt square card and a full-width hero at once.
--
-- Idempotent and additive, like the migrations before it. The photograph
-- itself is never touched.

alter table public.plants
  add column if not exists photo_zoom real not null default 1;

-- The client clamps what it writes; the column should not accept a value no
-- renderer of ours can use. Zero or negative would collapse the image to
-- nothing on every device at once.
alter table public.plants drop constraint if exists plants_photo_zoom_check;
alter table public.plants
  add constraint plants_photo_zoom_check check (photo_zoom >= 0.25 and photo_zoom <= 4);
